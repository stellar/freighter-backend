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
  currentPrice: BigNumber;
  percentagePriceChange24h: BigNumber | null;
}
