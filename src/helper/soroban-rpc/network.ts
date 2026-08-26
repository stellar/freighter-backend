import * as StellarSdkNext from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";
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
  // stellar-sdk 16 dropped the <Memo, Operation[]> type parameters on
  // Transaction; the class carries those as instance fields now.
  tx: StellarSdk.Transaction,
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
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
  return ledgerKey.toXdr("base64");
};

// Pulls the executable out of a contract instance ledger entry. Throws if the
// entry is not contract data holding a contract instance.
const getInstanceExecutable = (
  entryData:
    | StellarSdk.xdr.LedgerEntryData
    | StellarSdkNext.xdr.LedgerEntryData,
) => {
  const { xdr } = StellarSdk;
  const instanceVal = xdr.expectUnionVariant(entryData, "contractData")
    .contractData.val;
  return xdr.expectUnionVariant(instanceVal, "scvContractInstance").instance
    .executable;
};

const getExecutable = (
  contractLedgerEntryData: string,
  network: NetworkNames,
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr } = Sdk;
  return getInstanceExecutable(
    xdr.LedgerEntryData.fromXdr(contractLedgerEntryData, "base64"),
  );
};

const getLedgerKeyWasmId = (
  executable:
    | StellarSdk.xdr.ContractExecutable
    | StellarSdkNext.xdr.ContractExecutable,
  network: NetworkNames,
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr } = Sdk;
  const contractCodeWasmHash = xdr.expectUnionVariant(
    executable,
    "contractExecutableWasm",
  ).wasmHash;
  const ledgerKey = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({
      hash: contractCodeWasmHash.toBytes(),
    }),
  );
  return ledgerKey.toXdr("base64");
};

async function parseWasmXdr(xdrContents: string, network: NetworkNames) {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr, contract } = Sdk;
  const wasmBytes = xdr.expectUnionVariant(
    xdr.LedgerEntryData.fromXdr(xdrContents, "base64"),
    "contractCode",
  ).contractCode.code;
  const wasmModule = await WebAssembly.compile(wasmBytes);
  const [specSection] = WebAssembly.Module.customSections(
    wasmModule,
    "contractspecv0",
  );
  if (!specSection) {
    throw new Error("contract wasm has no contractspecv0 section");
  }

  const specs = xdr.decodeStream(xdr.ScSpecEntry, new Uint8Array(specSection));
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
    if (executable.type === "contractExecutableStellarAsset") {
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
  getInstanceExecutable,
  getLedgerEntries,
  getLedgerKeyContractCode,
  getLedgerKeyWasmId,
  getServer,
  getTxBuilder,
  parseWasmXdr,
  simulateTx,
  getStellarRpcUrls,
};
