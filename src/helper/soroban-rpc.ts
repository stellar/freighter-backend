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
} from "stellar-sdk";
import { NetworkNames } from "./validate";

const SOROBAN_RPC_URLS: { [key in keyof typeof Networks]?: string } = {
  TESTNET: "https://soroban-testnet.stellar.org/",
};

const getServer = async (network: NetworkNames) => {
  const serverUrl = SOROBAN_RPC_URLS[network];
  if (!serverUrl) {
    throw new Error("network not supported");
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

  throw new Error("Invalid response from simulateTransaction");
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

export {
  getServer,
  getTokenBalance,
  getTokenDecimals,
  getTokenName,
  getTokenSymbol,
  getTxBuilder,
  simulateTx,
  SOROBAN_RPC_URLS,
};
