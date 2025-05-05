import * as StellarSdkNext from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";
import { XdrReader } from "@stellar/js-xdr";
import { Logger } from "pino";

import { NetworkNames } from "../validate";
import { ERROR } from "../error";
import { getSdk } from "../stellar";
import { TOKEN_SPEC_DEFINITIONS } from "./token";
import { StellarRpcConfig } from "../../config";

const getStellarRpcUrls = (
  config: StellarRpcConfig,
): Partial<Record<NetworkNames, string>> => ({
  PUBLIC: config.freighterRpcPubnetUrl,
  TESTNET: config.freighterRpcTestnetUrl,
  FUTURENET: config.freighterRpcFuturenetUrl,
});

const getServer = async (network: NetworkNames, config: StellarRpcConfig) => {
  const serverUrl = getStellarRpcUrls(config)[network];
  if (!serverUrl) {
    if (network === "PUBLIC") {
      throw new Error("RPC pubnet URL is not set");
    }
    throw new Error(ERROR.UNSUPPORTED_NETWORK);
  }

  const Sdk = getSdk(StellarSdkNext.Networks[network]);

  return new Sdk.rpc.Server(serverUrl, {
    allowHttp: serverUrl.startsWith("http://"),
  });
};

const getTxBuilder = async (
  pubKey: string,
  network: NetworkNames,
  server: StellarSdk.rpc.Server | StellarSdkNext.rpc.Server,
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const sourceAccount = await server.getAccount(pubKey);
  return new Sdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks[network],
  });
};

const simulateTx = async <ArgType>(
  tx: StellarSdk.Transaction<
    StellarSdk.Memo<StellarSdk.MemoType>,
    StellarSdk.Operation[]
  >,
  server: StellarSdk.rpc.Server | StellarSdkNext.rpc.Server,
  networkPassphrase: StellarSdk.Networks,
): Promise<ArgType> => {
  const Sdk = getSdk(networkPassphrase);
  const simulatedTX = await server.simulateTransaction(tx);
  if (Sdk.rpc.Api.isSimulationSuccess(simulatedTX) && simulatedTX.result) {
    return Sdk.scValToNative(simulatedTX.result.retval);
  }

  if (Sdk.rpc.Api.isSimulationError(simulatedTX)) {
    throw new Error(simulatedTX.error);
  }

  throw new Error(ERROR.FAILED_TO_SIM);
};

const getLedgerKeyContractCode = (
  contractId: string,
  network: NetworkNames,
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { Address, xdr } = Sdk;

  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  return ledgerKey.toXDR("base64");
};

const getExecutable = (
  contractLedgerEntryData: string,
  network: NetworkNames,
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr } = Sdk;
  return xdr.LedgerEntryData.fromXDR(contractLedgerEntryData, "base64")
    .contractData()
    .val()
    .instance()
    .executable();
};

const getLedgerKeyWasmId = (
  executable:
    | StellarSdk.xdr.ContractExecutable
    | StellarSdkNext.xdr.ContractExecutable,
  network: NetworkNames,
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr } = Sdk;
  const contractCodeWasmHash = executable.wasmHash();
  const ledgerKey = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({
      hash: contractCodeWasmHash,
    }),
  );
  return ledgerKey.toXDR("base64");
};

async function parseWasmXdr(xdrContents: string, network: NetworkNames) {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr, contract } = Sdk;
  const wasmBuffer = xdr.LedgerEntryData.fromXDR(xdrContents, "base64")
    .contractCode()
    .code();
  const wasmModule = await WebAssembly.compile(wasmBuffer);
  const reader = new XdrReader(
    Buffer.from(
      WebAssembly.Module.customSections(wasmModule, "contractspecv0")[0],
    ),
  );

  const specs = [];
  do {
    specs.push(xdr.ScSpecEntry.read(reader));
  } while (!reader.eof);
  const contractSpec = new contract.Spec(specs);
  return contractSpec.jsonSchema();
}

const getLedgerEntries = async (
  entryKey: string,
  rpcUrl: string,
  id: number = new Date().getDate(),
): Promise<{
  error: Error;
  result: StellarSdk.rpc.Api.RawGetLedgerEntriesResponse;
}> => {
  let requestBody = {
    jsonrpc: "2.0",
    id: id,
    method: "getLedgerEntries",
    params: {
      keys: [entryKey],
    },
  };

  let res = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  let json = await res.json();
  if (!res.ok) {
    throw new Error(json);
  }
  return json;
};

const getContractSpec = async (
  contractId: string,
  network: NetworkNames,
  logger: Logger,
  config: StellarRpcConfig,
) => {
  try {
    const Sdk = getSdk(StellarSdkNext.Networks[network]);
    const { xdr } = Sdk;

    const serverUrl = getStellarRpcUrls(config)[network];
    if (!serverUrl) {
      if (network === "PUBLIC") {
        throw new Error("RPC pubnet URL is not set");
      }
      throw new Error(ERROR.UNSUPPORTED_NETWORK);
    }

    const contractDataKey = getLedgerKeyContractCode(contractId, network);
    const { error, result } = await getLedgerEntries(
      contractDataKey,
      serverUrl,
    );
    const entries = result.entries || [];
    if (error || !entries.length) {
      logger.error(error);
      return { error: "Unable to fetch contract spec", result: null };
    }

    const contractCodeLedgerEntryData = entries[0].xdr;
    const executable = getExecutable(contractCodeLedgerEntryData, network);
    if (
      executable.switch().name ===
      xdr.ContractExecutableType.contractExecutableStellarAsset().name
    ) {
      return {
        result: TOKEN_SPEC_DEFINITIONS,
        error: null,
      };
    }

    const wasmId = getLedgerKeyWasmId(executable, network);
    const { error: wasmError, result: wasmResult } = await getLedgerEntries(
      wasmId,
      serverUrl,
    );
    const wasmEntries = wasmResult.entries || [];
    if (wasmError || !wasmEntries.length) {
      logger.error(wasmError);
      return { error: "Unable to fetch contract spec", result: null };
    }

    const spec = await parseWasmXdr(wasmEntries[0].xdr, network);
    return { result: spec, error: null };
  } catch (error) {
    logger.error(error);
    return { error: "Unable to fetch contract spec", result: null };
  }
};

export {
  getContractSpec,
  getExecutable,
  getLedgerEntries,
  getLedgerKeyContractCode,
  getLedgerKeyWasmId,
  getServer,
  getTxBuilder,
  parseWasmXdr,
  simulateTx,
  getStellarRpcUrls,
};
