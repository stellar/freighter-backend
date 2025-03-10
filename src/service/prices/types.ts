import {
  RedisClientType,
  RedisModules,
  RedisFunctions,
  RedisScripts,
} from "redis";
import TimeSeriesCommands from "@redis/time-series";
import BigNumber from "bignumber.js";

export type RedisClientWithTS = RedisClientType<
  RedisModules & { ts: typeof TimeSeriesCommands },
  RedisFunctions,
  RedisScripts
>;

export interface TokenPriceData {
  readonly currentPrice: BigNumber;
  readonly percentagePriceChange24h: BigNumber | null;
}

export interface PriceCalculationResult {
  readonly timestamp: number;
  readonly price: BigNumber;
}

export type TokenKey = string;

export interface MAddEntry {
  readonly key: string;
  readonly timestamp: number;
  readonly value: number;
}

export interface TimeSeriesEntry {
  readonly timestamp: number;
  readonly value: number;
}
