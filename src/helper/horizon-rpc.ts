import BigNumber from "bignumber.js";
import * as StellarSdkNext from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";
import { getSdk } from "./stellar";
import { NetworkNames } from "./validate";

export const BASE_RESERVE = 0.5;
export const BASE_RESERVE_MIN_COUNT = 2;
const TRANSACTIONS_LIMIT = 100;

export enum NETWORK_URLS {
  PUBLIC = "https://horizon.stellar.org",
  TESTNET = "https://horizon-testnet.stellar.org",
  FUTURENET = "https://horizon-futurenet.stellar.org",
  SANDBOX = "",
  STANDALONE = "",
}

export interface Issuer {
  key: string;
  name?: string;
  url?: string;
  hostName?: string;
}

export interface NativeToken {
  type: StellarSdk.AssetType;
  code: string;
}

export interface AssetToken {
  type: StellarSdk.AssetType;
  code: string;
  issuer: Issuer;
  anchorAsset?: string;
  numAccounts?: BigNumber;
  amount?: BigNumber;
  bidCount?: BigNumber;
  askCount?: BigNumber;
  spread?: BigNumber;
}

export type Token = NativeToken | AssetToken;

export interface Balance {
  token: Token;

  // for non-native tokens, this should be total - sellingLiabilities
  // for native, it should also subtract the minimumBalance
  available: BigNumber;
  total: BigNumber;
  buyingLiabilities: BigNumber;
  sellingLiabilities: BigNumber;
}

export interface AssetBalance extends Balance {
  token: AssetToken;
  sponsor?: string;
}

export interface NativeBalance extends Balance {
  token: NativeToken;
  minimumBalance: BigNumber;
}

export interface BalanceMap {
  [key: string]: AssetBalance | NativeBalance;
  native: NativeBalance;
}

export function getBalanceIdentifier(
  balance: StellarSdk.Horizon.HorizonApi.BalanceLine,
): string {
  if ("asset_issuer" in balance && !balance.asset_issuer) {
    return "native";
  }
  switch (balance.asset_type) {
    case "credit_alphanum4":
    case "credit_alphanum12":
      return `${balance.asset_code}:${balance.asset_issuer}`;

    case "liquidity_pool_shares":
      return `${balance.liquidity_pool_id}:lp`;

    default:
      return "native";
  }
}

export function getAssetType(code?: string) {
  if (!code) {
    return "native";
  }
  if (code.length > 4) {
    return "credit_alphanum12";
  }
  return "credit_alphanum4";
}

export const makeDisplayableBalances = (
  accountDetails: StellarSdk.Horizon.ServerApi.AccountRecord,
) => {
  const { balances, subentry_count, num_sponsored, num_sponsoring } =
    accountDetails;

  const displayableBalances = Object.values(balances).reduce(
    (memo, balance) => {
      const identifier = getBalanceIdentifier(balance);
      const total = new BigNumber(balance.balance);

      let sellingLiabilities = new BigNumber(0);
      let buyingLiabilities = new BigNumber(0);
      let available;

      if ("selling_liabilities" in balance) {
        sellingLiabilities = new BigNumber(balance.selling_liabilities);
        available = total.minus(sellingLiabilities);
      }

      if ("buying_liabilities" in balance) {
        buyingLiabilities = new BigNumber(balance.buying_liabilities);
      }

      if (identifier === "native") {
        // define the native balance line later
        return {
          ...memo,
          native: {
            token: {
              type: "native",
              code: "XLM",
            },
            total,
            available,
            sellingLiabilities,
            buyingLiabilities,

            /* tslint:disable */
            // https://developers.stellar.org/docs/glossary/sponsored-reserves/#sponsorship-effect-on-minimum-balance
            /* tslint:enable */
            minimumBalance: new BigNumber(BASE_RESERVE_MIN_COUNT)
              .plus(subentry_count)
              .plus(num_sponsoring)
              .minus(num_sponsored)
              .times(BASE_RESERVE)
              .plus(sellingLiabilities),
          },
        };
      }

      const liquidityPoolBalance =
        balance as StellarSdk.Horizon.HorizonApi.BalanceLineLiquidityPool;

      if (identifier.includes(":lp")) {
        return {
          ...memo,
          [identifier]: {
            liquidity_pool_id: liquidityPoolBalance.liquidity_pool_id,
            total,
            limit: new BigNumber(liquidityPoolBalance.limit),
          },
        };
      }

      const assetBalance =
        balance as StellarSdk.Horizon.HorizonApi.BalanceLineAsset;
      const assetSponsor = assetBalance.sponsor
        ? { sponsor: assetBalance.sponsor }
        : {};

      return {
        ...memo,
        [identifier]: {
          token: {
            type: assetBalance.asset_type,
            code: assetBalance.asset_code,
            issuer: {
              key: assetBalance.asset_issuer,
            },
          },
          sellingLiabilities,
          buyingLiabilities,
          total,
          limit: new BigNumber(assetBalance.limit),
          available: total.minus(sellingLiabilities),
          ...assetSponsor,
        },
      };
    },
    {},
  );

  return displayableBalances as BalanceMap;
};

export const fetchAccountDetails = async (
  pubKey: string,
  server: StellarSdkNext.Horizon.Server | StellarSdk.Horizon.Server,
) => {
  try {
    const accountSummary = await server.accounts().accountId(pubKey).call();

    const balances = makeDisplayableBalances(accountSummary);
    const sponsor = accountSummary.sponsor
      ? { sponsor: accountSummary.sponsor }
      : {};

    return {
      ...sponsor,
      id: accountSummary.id,
      subentryCount: accountSummary.subentry_count,
      sponsoredCount: accountSummary.num_sponsored,
      sponsoringCount: accountSummary.num_sponsoring,
      inflationDestination: accountSummary.inflation_destination,
      thresholds: accountSummary.thresholds,
      signers: accountSummary.signers,
      flags: accountSummary.flags,
      sequenceNumber: accountSummary.sequence,
      balances,
    };
  } catch (error) {
    throw new Error(JSON.stringify(error));
  }
};

export const fetchAccountHistory = async (
  pubKey: string,
  server: StellarSdkNext.Horizon.Server | StellarSdk.Horizon.Server,
  isFailedIncluded: boolean = false,
) => {
  try {
    const operationsData = await server
      .operations()
      .forAccount(pubKey)
      .order("desc")
      .includeFailed(isFailedIncluded)
      .join("transactions")
      .limit(TRANSACTIONS_LIMIT)
      .call();

    return operationsData.records || [];
  } catch (error) {
    throw new Error(JSON.stringify(error));
  }
};

const networkPassphraseToName = (passphrase: string): NetworkNames | null => {
  const entries = Object.entries(StellarSdk.Networks) as [
    NetworkNames,
    string,
  ][];
  for (const [name, value] of entries) {
    if (value === passphrase) return name;
  }
  return null;
};

const MAX_SUBMIT_RETRIES = 3;

interface SubmitTransactionResult {
  data: StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse | null;
  error: string | StellarSdk.Horizon.HorizonApi.ErrorResponseData | null;
}

export const submitTransaction = async (
  signedXDR: string,
  networkPassphrase: string,
): Promise<SubmitTransactionResult> => {
  const network = networkPassphraseToName(networkPassphrase);
  if (!network) {
    return {
      data: null,
      error: `Unknown network passphrase: ${networkPassphrase}`,
    };
  }

  const networkUrl = NETWORK_URLS[network];
  if (!networkUrl) {
    return {
      data: null,
      error: `Unsupported network for transaction submission: ${network}`,
    };
  }

  const Sdk = getSdk(networkPassphrase as StellarSdk.Networks);
  const tx = Sdk.TransactionBuilder.fromXDR(signedXDR, networkPassphrase);
  const server = new Sdk.Horizon.Server(networkUrl);

  let lastError: StellarSdk.Horizon.HorizonApi.ErrorResponseData | null = null;

  for (let attempt = 0; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
    try {
      const data = await server.submitTransaction(tx);
      return {
        data,
        error: null,
      };
    } catch (e: unknown) {
      const response = (
        e as {
          response?: {
            status?: number;
            data?: StellarSdk.Horizon.HorizonApi.ErrorResponseData;
          };
        }
      ).response;
      lastError = response?.data ?? null;
      if (response?.status !== 504) {
        break;
      }
      // Retry on 504 timeout
      // https://developers.stellar.org/api/errors/http-status-codes/horizon-specific/timeout
      // https://developers.stellar.org/docs/encyclopedia/error-handling
    }
  }

  return {
    data: null,
    error: lastError,
  };
};
