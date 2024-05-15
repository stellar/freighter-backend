import * as StellarSdkNext from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";
import { XdrReader } from "@stellar/js-xdr";
import { NetworkNames } from "../validate";
import { ERROR } from "../error";
import { Logger } from "pino";
import { getSdk } from "../stellar";

const SOROBAN_RPC_URLS: { [key in keyof typeof StellarSdk.Networks]?: string } =
  {
    PUBLIC:
      "http://soroban-rpc-pubnet-prd.soroban-rpc-pubnet-prd.svc.cluster.local:8000",
    TESTNET: "https://soroban-testnet.stellar.org/",
    FUTURENET: "https://rpc-futurenet.stellar.org/",
  };

const getServer = async (network: NetworkNames) => {
  const serverUrl = SOROBAN_RPC_URLS[network];
  if (!serverUrl) {
    throw new Error(ERROR.UNSUPPORTED_NETWORK);
  }

  const Sdk = getSdk(StellarSdkNext.Networks[network]);

  return new Sdk.SorobanRpc.Server(serverUrl, {
    allowHttp: serverUrl.startsWith("http://"),
  });
};

const getTxBuilder = async (
  pubKey: string,
  network: NetworkNames,
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server
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
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server,
  networkPassphrase: StellarSdk.Networks
): Promise<ArgType> => {
  const Sdk = getSdk(networkPassphrase);
  const simulatedTX = await server.simulateTransaction(tx);
  if (
    Sdk.SorobanRpc.Api.isSimulationSuccess(simulatedTX) &&
    simulatedTX.result
  ) {
    return Sdk.scValToNative(simulatedTX.result.retval);
  }

  if (Sdk.SorobanRpc.Api.isSimulationError(simulatedTX)) {
    throw new Error(simulatedTX.error);
  }

  throw new Error(ERROR.FAILED_TO_SIM);
};

const getTokenDecimals = async (
  contractId: string,
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server,
  builder: StellarSdk.TransactionBuilder,
  network: NetworkNames
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const contract = new Sdk.Contract(contractId);

  const tx = builder
    .addOperation(contract.call("decimals"))
    .setTimeout(Sdk.TimeoutInfinite)
    .build();

  const result = await simulateTx<string>(
    tx,
    server,
    StellarSdkNext.Networks[network]
  );
  return result;
};

const getTokenName = async (
  contractId: string,
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server,
  builder: StellarSdk.TransactionBuilder,
  network: NetworkNames
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const contract = new Sdk.Contract(contractId);

  const tx = builder
    .addOperation(contract.call("name"))
    .setTimeout(Sdk.TimeoutInfinite)
    .build();

  const result = await simulateTx<string>(
    tx,
    server,
    StellarSdkNext.Networks[network]
  );
  return result;
};

const getTokenSymbol = async (
  contractId: string,
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server,
  builder: StellarSdk.TransactionBuilder,
  network: NetworkNames
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const contract = new Sdk.Contract(contractId);

  const tx = builder
    .addOperation(contract.call("symbol"))
    .setTimeout(Sdk.TimeoutInfinite)
    .build();

  const result = await simulateTx<string>(
    tx,
    server,
    StellarSdkNext.Networks[network]
  );
  return result;
};

const getTokenBalance = async (
  contractId: string,
  params: StellarSdk.xdr.ScVal[],
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server,
  builder: StellarSdk.TransactionBuilder,
  network: NetworkNames
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const contract = new Sdk.Contract(contractId);

  const tx = builder
    .addOperation(contract.call("balance", ...params))
    .setTimeout(Sdk.TimeoutInfinite)
    .build();

  const result = await simulateTx<number>(
    tx,
    server,
    StellarSdkNext.Networks[network]
  );
  return result;
};

const buildTransfer = (
  contractId: string,
  params: StellarSdk.xdr.ScVal[],
  memo: string | undefined,
  builder: StellarSdk.TransactionBuilder,
  networkPassphrase: StellarSdk.Networks
) => {
  const Sdk = getSdk(networkPassphrase);
  const contract = new Sdk.Contract(contractId);

  const tx = builder
    .addOperation(contract.call("transfer", ...params))
    .setTimeout(Sdk.TimeoutInfinite);

  if (memo) {
    tx.addMemo(Sdk.Memo.text(memo));
  }

  return tx.build();
};

// https://github.com/stellar/soroban-examples/blob/main/token/src/contract.rs
enum SorobanTokenInterface {
  transfer = "transfer",
  mint = "mint",
}

const getOpArgs = (
  fnName: string,
  args: StellarSdk.xdr.ScVal[],
  network: NetworkNames
) => {
  const Sdk = getSdk(StellarSdk.Networks[network]);

  let amount: number;
  let from;
  let to;

  switch (fnName) {
    case SorobanTokenInterface.transfer:
      from = Sdk.StrKey.encodeEd25519PublicKey(
        args[0].address().accountId().ed25519()
      );
      to = Sdk.StrKey.encodeEd25519PublicKey(
        args[1].address().accountId().ed25519()
      );
      amount = Sdk.scValToNative(args[2]).toString();
      break;
    case SorobanTokenInterface.mint:
      to = Sdk.StrKey.encodeEd25519PublicKey(
        args[0].address().accountId().ed25519()
      );
      amount = Sdk.scValToNative(args[1]).toString();
      break;
    default:
      amount = 0;
  }

  return { from, to, amount };
};

const getLedgerKeyContractCode = (
  contractId: string,
  network: NetworkNames
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { Address, xdr } = Sdk;

  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
  return ledgerKey.toXDR("base64");
};

const getLedgerKeyWasmId = (
  contractLedgerEntryData: string,
  network: NetworkNames
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr } = Sdk;
  const contractCodeWasmHash = xdr.LedgerEntryData.fromXDR(
    contractLedgerEntryData,
    "base64"
  )
    .contractData()
    .val()
    .instance()
    .executable()
    .wasmHash();
  const ledgerKey = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({
      hash: contractCodeWasmHash,
    })
  );
  return ledgerKey.toXDR("base64");
};

async function parseWasmXdr(xdrContents: string, network: NetworkNames) {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr, ContractSpec } = Sdk;
  const wasmBuffer = xdr.LedgerEntryData.fromXDR(xdrContents, "base64")
    .contractCode()
    .code();
  const wasmModule = await WebAssembly.compile(wasmBuffer);
  const reader = new XdrReader(
    Buffer.from(
      WebAssembly.Module.customSections(wasmModule, "contractspecv0")[0]
    )
  );

  const specs = [];
  do {
    specs.push(xdr.ScSpecEntry.read(reader));
  } while (!reader.eof);
  const contractSpec = new ContractSpec(specs);
  return contractSpec.jsonSchema();
}

const getLedgerEntries = async (
  entryKey: string,
  rpcUrl: string,
  id: number = new Date().getDate()
): Promise<{
  error: Error;
  result: StellarSdk.SorobanRpc.Api.RawGetLedgerEntriesResponse;
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
  logger: Logger
) => {
  try {
    const serverUrl = SOROBAN_RPC_URLS[network];
    if (!serverUrl) {
      throw new Error(ERROR.UNSUPPORTED_NETWORK);
    }

    const contractDataKey = getLedgerKeyContractCode(contractId, network);
    const { error, result } = await getLedgerEntries(
      contractDataKey,
      serverUrl
    );
    const entries = result.entries || [];
    if (error || !entries.length) {
      logger.error(error);
      return { error: "Unable to fetch contract spec", result: null };
    }

    const contractCodeLedgerEntryData = entries[0].xdr;
    const wasmId = getLedgerKeyWasmId(contractCodeLedgerEntryData, network);
    const { error: wasmError, result: wasmResult } = await getLedgerEntries(
      wasmId,
      serverUrl
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

const getIsTokenSpec = async (
  contractId: string,
  network: NetworkNames,
  logger: Logger
) => {
  try {
    const spec = await getContractSpec(contractId, network, logger);
    return { error: null, result: isTokenSpec(spec) };
  } catch (error) {
    logger.error(error);
    return { error: "Unable to fetch token spec", result: null };
  }
};

const TOKEN_SPEC: { [index: string]: { args: { name: string }[] } } = {
  allowance: {
    args: [{ name: "from" }, { name: "spender" }],
  },
  approve: {
    args: [
      { name: "amount" },
      { name: "expiration_ledger" },
      { name: "from" },
      { name: "spender" },
    ],
  },
  balance: {
    args: [{ name: "id" }],
  },
  burn: {
    args: [{ name: "amount" }, { name: "from" }],
  },
  burn_from: {
    args: [{ name: "amount" }, { name: "from" }, { name: "spender" }],
  },
  decimals: {
    args: [],
  },
  initialize: {
    args: [
      { name: "admin" },
      { name: "decimal" },
      { name: "name" },
      { name: "symbol" },
    ],
  },
  mint: {
    args: [{ name: "amount" }, { name: "to" }],
  },
  name: {
    args: [],
  },
  set_admin: {
    args: [{ name: "new_admin" }],
  },
  symbol: {
    args: [],
  },
  transfer: {
    args: [{ name: "amount" }, { name: "from" }, { name: "to" }],
  },
  transfer_from: {
    args: [
      { name: "amount" },
      { name: "from" },
      { name: "spender" },
      { name: "to" },
    ],
  },
};

const isTokenSpec = (spec: Record<string, any>) => {
  const definitions = spec.definitions || [];
  const tokenInterfaceMethods = Object.keys(TOKEN_SPEC);

  for (const method of tokenInterfaceMethods) {
    const methodDef = definitions[method];
    if (!methodDef) {
      return false;
    }

    const tokenSpecMethod = TOKEN_SPEC[method].args.map((arg) => arg.name);
    const args = methodDef.properties?.args?.properties;
    const contractMethods = Object.keys(args || {});
    const doesMatchSpec = tokenSpecMethod.every((specMethod) =>
      contractMethods.includes(specMethod)
    );

    if (!doesMatchSpec) {
      return false;
    }
  }
  return true;
};

const isSacContractExecutable = async (
  contractId: string,
  network: NetworkNames
) => {
  // verify the contract executable in the instance entry
  // The SAC has a unique contract executable type
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr } = Sdk;
  const server = await getServer(network);
  const instance = new Sdk.Contract(contractId).getFootprint();
  const ledgerKeyContractCode = instance.toXDR("base64");

  const { entries } = await server.getLedgerEntries(
    xdr.LedgerKey.fromXDR(ledgerKeyContractCode, "base64")
  );

  if (entries && entries.length) {
    const parsed = entries[0].val;
    const executable = parsed.contractData().val().instance().executable();

    return (
      executable.switch().name ===
      xdr.ContractExecutableType.contractExecutableStellarAsset().name
    );
  }
  throw new Error(ERROR.ENTRY_NOT_FOUND.CONTRACT_CODE);
};

const isSacContract = (
  name: string,
  contractId: string,
  network: StellarSdk.Networks
) => {
  const Sdk = getSdk(network);
  if (name.includes(":")) {
    try {
      return (
        new Sdk.Asset(...(name.split(":") as [string, string])).contractId(
          network
        ) === contractId
      );
    } catch (error) {
      return false;
    }
  }

  return false;
};

export {
  buildTransfer,
  getContractSpec,
  getIsTokenSpec,
  getLedgerEntries,
  getLedgerKeyContractCode,
  getLedgerKeyWasmId,
  getOpArgs,
  getServer,
  getTokenBalance,
  getTokenDecimals,
  getTokenName,
  getTokenSymbol,
  getTxBuilder,
  isSacContract,
  isSacContractExecutable,
  isTokenSpec,
  parseWasmXdr,
  simulateTx,
  SOROBAN_RPC_URLS,
  TOKEN_SPEC,
};
