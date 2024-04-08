import {
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  TimeoutInfinite,
  Transaction,
  Memo,
  MemoType,
  Operation,
  scValToNative,
  xdr,
  SorobanRpc,
  StrKey,
  Address,
  ContractSpec,
} from "stellar-sdk";
import { XdrReader } from "@stellar/js-xdr";
import { NetworkNames } from "./validate";
import { ERROR } from "./error";

const SOROBAN_RPC_URLS: { [key in keyof typeof Networks]?: string } = {
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

  return new SorobanRpc.Server(serverUrl, {
    allowHttp: serverUrl.startsWith("http://"),
  });
};

const getTxBuilder = async (
  pubKey: string,
  network: NetworkNames,
  server: SorobanRpc.Server
) => {
  const sourceAccount = await server.getAccount(pubKey);
  return new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: Networks[network],
  });
};

const simulateTx = async <ArgType>(
  tx: Transaction<Memo<MemoType>, Operation[]>,
  server: SorobanRpc.Server
): Promise<ArgType> => {
  const simulatedTX = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationSuccess(simulatedTX) && simulatedTX.result) {
    return scValToNative(simulatedTX.result.retval);
  }

  if (SorobanRpc.Api.isSimulationError(simulatedTX)) {
    throw new Error(simulatedTX.error);
  }

  throw new Error(ERROR.FAILED_TO_SIM);
};

const getTokenDecimals = async (
  contractId: string,
  server: SorobanRpc.Server,
  builder: TransactionBuilder
) => {
  const contract = new Contract(contractId);

  const tx = builder
    .addOperation(contract.call("decimals"))
    .setTimeout(TimeoutInfinite)
    .build();

  const result = await simulateTx<string>(tx, server);
  return result;
};

const getTokenName = async (
  contractId: string,
  server: SorobanRpc.Server,
  builder: TransactionBuilder
) => {
  const contract = new Contract(contractId);

  const tx = builder
    .addOperation(contract.call("name"))
    .setTimeout(TimeoutInfinite)
    .build();

  const result = await simulateTx<string>(tx, server);
  return result;
};

const getTokenSymbol = async (
  contractId: string,
  server: SorobanRpc.Server,
  builder: TransactionBuilder
) => {
  const contract = new Contract(contractId);

  const tx = builder
    .addOperation(contract.call("symbol"))
    .setTimeout(TimeoutInfinite)
    .build();

  const result = await simulateTx<string>(tx, server);
  return result;
};

const getTokenBalance = async (
  contractId: string,
  params: xdr.ScVal[],
  server: SorobanRpc.Server,
  builder: TransactionBuilder
) => {
  const contract = new Contract(contractId);

  const tx = builder
    .addOperation(contract.call("balance", ...params))
    .setTimeout(TimeoutInfinite)
    .build();

  const result = await simulateTx<number>(tx, server);
  return result;
};

const buildTransfer = (
  contractId: string,
  params: xdr.ScVal[],
  memo: string | undefined,
  builder: TransactionBuilder
) => {
  const contract = new Contract(contractId);

  const tx = builder
    .addOperation(contract.call("transfer", ...params))
    .setTimeout(TimeoutInfinite);

  if (memo) {
    tx.addMemo(Memo.text(memo));
  }

  return tx.build();
};

// https://github.com/stellar/soroban-examples/blob/main/token/src/contract.rs
enum SorobanTokenInterface {
  transfer = "transfer",
  mint = "mint",
}

const getOpArgs = (fnName: string, args: xdr.ScVal[]) => {
  let amount: number;
  let from;
  let to;

  switch (fnName) {
    case SorobanTokenInterface.transfer:
      from = StrKey.encodeEd25519PublicKey(
        args[0].address().accountId().ed25519()
      );
      to = StrKey.encodeEd25519PublicKey(
        args[1].address().accountId().ed25519()
      );
      amount = scValToNative(args[2]).toString();
      break;
    case SorobanTokenInterface.mint:
      to = StrKey.encodeEd25519PublicKey(
        args[0].address().accountId().ed25519()
      );
      amount = scValToNative(args[1]).toString();
      break;
    default:
      amount = 0;
  }

  return { from, to, amount };
};

const getLedegerKeyContractCode = (contractId: string) => {
  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
  return ledgerKey.toXDR("base64");
};

const getLedgerKeyWasmId = (contractCodeLedgerEntryData: string) => {
  const contractCodeWasmHash = xdr.LedgerEntryData.fromXDR(
    contractCodeLedgerEntryData,
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

async function parseWasmXdr(xdrContents: string) {
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
  result: SorobanRpc.Api.RawGetLedgerEntriesResponse;
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

const getTokenSpec = async (contractId: string, network: NetworkNames) => {
  try {
    const serverUrl = SOROBAN_RPC_URLS[network];
    if (!serverUrl) {
      throw new Error(ERROR.UNSUPPORTED_NETWORK);
    }

    const contractDataKey = getLedegerKeyContractCode(contractId);
    const { error, result } = await getLedgerEntries(
      contractDataKey,
      serverUrl
    );
    const entries = result.entries || [];
    if (error || !entries.length) {
      return { error: "Unable to fetch token spec", result: null };
    }

    const contractCodeLedgerEntryData = entries[0].xdr;
    const wasmId = getLedgerKeyWasmId(contractCodeLedgerEntryData);
    const { error: wasmError, result: wasmResult } = await getLedgerEntries(
      wasmId,
      serverUrl
    );
    const wasmEntries = wasmResult.entries || [];
    if (wasmError || !wasmEntries.length) {
      return { error: "Unable to fetch token spec", result: null };
    }

    const wasm = await parseWasmXdr(wasmEntries[0].xdr);
    return { error, result: wasm };
  } catch (error) {
    return { error, result: null };
  }
};

export {
  buildTransfer,
  getLedgerEntries,
  getOpArgs,
  getServer,
  getTokenBalance,
  getTokenDecimals,
  getTokenName,
  getTokenSpec,
  getTokenSymbol,
  getTxBuilder,
  simulateTx,
  SOROBAN_RPC_URLS,
};
