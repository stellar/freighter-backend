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
} from "stellar-sdk";
import { NetworkNames } from "./validate";
import { ERROR } from "./error";

const SOROBAN_RPC_URLS: { [key in keyof typeof Networks]?: string } = {
  PUBLIC:
    "http://soroban-rpc-pubnet-dev.soroban-rpc-pubnet-dev.svc.cluster.local:8000",
  TESTNET: "https://soroban-testnet.stellar.org/",
  FUTURENET: "https://rpc-futurenet.stellar.org/",
};

const getServer = async (network: NetworkNames, customRpcUrl?: string) => {
  const serverUrl = !SOROBAN_RPC_URLS[network]
    ? customRpcUrl
    : SOROBAN_RPC_URLS[network];
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
  if ("result" in simulatedTX && simulatedTX.result !== undefined) {
    return scValToNative(simulatedTX.result.retval);
  }

  throw new Error(ERROR.INVALID_SIMULATION);
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

  const result = await simulateTx<number>(tx, server);
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

export {
  buildTransfer,
  getOpArgs,
  getServer,
  getTokenBalance,
  getTokenDecimals,
  getTokenName,
  getTokenSymbol,
  getTxBuilder,
  simulateTx,
  SOROBAN_RPC_URLS,
};
