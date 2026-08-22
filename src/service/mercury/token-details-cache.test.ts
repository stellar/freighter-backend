import { Redis } from "ioredis";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { StellarRpcConfig } from "../../config";
import * as SorobanRpcNetworkHelper from "../../helper/soroban-rpc/network";
import * as SorobanRpcTokenHelper from "../../helper/soroban-rpc/token";
import { MercuryClient, TOKEN_DETAILS_TTL_SECONDS } from ".";

const pubKey = "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL";
const contractId = "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
const network = "TESTNET" as const;

const makeRedisClient = (cachedValue: string | null = null) => ({
  get: jest.fn(async () => cachedValue),
  set: jest.fn(async () => "OK" as const),
  del: jest.fn(async () => 1),
});

const makeClient = (redisClient: ReturnType<typeof makeRedisClient>) => {
  const counter = {} as any;
  return new MercuryClient(
    {} as any,
    { warn: jest.fn() } as any,
    { registerMetric: jest.fn() } as any,
    {
      mercuryErrorCounter: counter,
      rpcErrorCounter: counter,
      criticalError: counter,
    },
    {} as StellarRpcConfig,
    redisClient as unknown as Redis,
  );
};

const getCacheKey = (client: MercuryClient) =>
  (client as any).tokenDetailsCacheKey(network, contractId) as string;

const mockRpc = () => {
  jest.spyOn(SorobanRpcNetworkHelper, "getServer").mockResolvedValue({} as any);
  jest
    .spyOn(SorobanRpcNetworkHelper, "getTxBuilder")
    .mockResolvedValue({} as any);
  const decimals = jest
    .spyOn(SorobanRpcTokenHelper, "getTokenDecimals")
    .mockResolvedValue("7");
  const name = jest
    .spyOn(SorobanRpcTokenHelper, "getTokenName")
    .mockResolvedValue("Test Token");
  const symbol = jest
    .spyOn(SorobanRpcTokenHelper, "getTokenSymbol")
    .mockResolvedValue("TST");

  return { decimals, name, symbol };
};

describe("Mercury token details cache", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("caches descriptive metadata with a versioned key and finite TTL", async () => {
    const redisClient = makeRedisClient();
    const client = makeClient(redisClient);
    const cacheKey = getCacheKey(client);
    mockRpc();

    await client.tokenDetails(pubKey, contractId, network);

    expect(redisClient.set).toHaveBeenCalledWith(
      cacheKey,
      JSON.stringify({ name: "Test Token", decimals: "7", symbol: "TST" }),
      "EX",
      TOKEN_DETAILS_TTL_SECONDS,
    );
  });

  it("returns cached metadata without ledger simulations", async () => {
    const redisClient = makeRedisClient(
      JSON.stringify({
        name: "Cached Token",
        symbol: "CACHED",
        decimals: "9",
      }),
    );
    const client = makeClient(redisClient);
    const rpc = mockRpc();

    const result = await client.tokenDetails(pubKey, contractId, network);

    expect(result).toEqual({
      name: "Cached Token",
      symbol: "CACHED",
      decimals: "9",
    });
    expect(rpc.decimals).not.toHaveBeenCalled();
    expect(rpc.name).not.toHaveBeenCalled();
    expect(rpc.symbol).not.toHaveBeenCalled();
    expect(SorobanRpcNetworkHelper.getTxBuilder).not.toHaveBeenCalled();
    expect(redisClient.set).not.toHaveBeenCalled();
  });

  it("deletes malformed cached metadata and replaces it from the ledger", async () => {
    const redisClient = makeRedisClient(
      JSON.stringify({ name: "Missing decimals", symbol: "BAD" }),
    );
    const client = makeClient(redisClient);
    const cacheKey = getCacheKey(client);
    mockRpc();

    const result = await client.tokenDetails(pubKey, contractId, network);

    expect(redisClient.del).toHaveBeenCalledWith(cacheKey);
    expect(redisClient.set).toHaveBeenCalledWith(
      cacheKey,
      JSON.stringify({ name: "Test Token", decimals: "7", symbol: "TST" }),
      "EX",
      TOKEN_DETAILS_TTL_SECONDS,
    );
    expect(result).toEqual({
      name: "Test Token",
      symbol: "TST",
      decimals: "7",
    });
  });

  it("invalidates one network and contract cache entry", async () => {
    const redisClient = makeRedisClient();
    const client = makeClient(redisClient);
    const cacheKey = getCacheKey(client);

    await client.invalidateTokenDetails(contractId, network);

    expect(redisClient.del).toHaveBeenCalledWith(cacheKey);
  });
});
