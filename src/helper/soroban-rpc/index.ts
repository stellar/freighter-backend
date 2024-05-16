import * as StellarSdkNext from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";
import { XdrReader } from "@stellar/js-xdr";
import { NetworkNames } from "../validate";
import { ERROR } from "../error";
import { Logger } from "pino";
import { getSdk } from "../stellar";

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

const TOKEN_SPEC_DEFINITIONS = {
  $schema: "http://json-schema.org/draft-07/schema#",
  definitions: {
    U32: {
      type: "integer",
      minimum: 0,
      maximum: 4294967295,
    },
    I32: {
      type: "integer",
      minimum: -2147483648,
      maximum: 2147483647,
    },
    U64: {
      type: "string",
      pattern: "^([1-9][0-9]*|0)$",
      minLength: 1,
      maxLength: 20,
    },
    I64: {
      type: "string",
      pattern: "^(-?[1-9][0-9]*|0)$",
      minLength: 1,
      maxLength: 21,
    },
    U128: {
      type: "string",
      pattern: "^([1-9][0-9]*|0)$",
      minLength: 1,
      maxLength: 39,
    },
    I128: {
      type: "string",
      pattern: "^(-?[1-9][0-9]*|0)$",
      minLength: 1,
      maxLength: 40,
    },
    U256: {
      type: "string",
      pattern: "^([1-9][0-9]*|0)$",
      minLength: 1,
      maxLength: 78,
    },
    I256: {
      type: "string",
      pattern: "^(-?[1-9][0-9]*|0)$",
      minLength: 1,
      maxLength: 79,
    },
    Address: {
      type: "string",
      format: "address",
      description: "Address can be a public key or contract id",
    },
    ScString: {
      type: "string",
      description: "ScString is a string",
    },
    ScSymbol: {
      type: "string",
      description: "ScString is a string",
    },
    DataUrl: {
      type: "string",
      pattern:
        "^(?:[A-Za-z0-9+\\/]{4})*(?:[A-Za-z0-9+\\/]{2}==|[A-Za-z0-9+\\/]{3}=)?$",
    },
    AuctionData: {
      description: "",
      properties: {
        bid: {
          type: "array",
          items: {
            type: "array",
            items: [
              {
                $ref: "#/definitions/Address",
              },
              {
                $ref: "#/definitions/I128",
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        block: {
          $ref: "#/definitions/U32",
        },
        lot: {
          type: "array",
          items: {
            type: "array",
            items: [
              {
                $ref: "#/definitions/Address",
              },
              {
                $ref: "#/definitions/I128",
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        additionalProperties: false,
      },
      required: ["bid", "block", "lot"],
      type: "object",
    },
    initialize: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            admin: {
              $ref: "#/definitions/Address",
            },
            name: {
              $ref: "#/definitions/ScSymbol",
            },
            oracle: {
              $ref: "#/definitions/Address",
            },
            bstop_rate: {
              $ref: "#/definitions/U32",
            },
            max_postions: {
              $ref: "#/definitions/U32",
            },
            backstop_id: {
              $ref: "#/definitions/Address",
            },
            blnd_id: {
              $ref: "#/definitions/Address",
            },
          },
          type: "object",
          required: [
            "admin",
            "name",
            "oracle",
            "bstop_rate",
            "max_postions",
            "backstop_id",
            "blnd_id",
          ],
        },
      },
      additionalProperties: false,
    },
    set_admin: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            new_admin: {
              $ref: "#/definitions/Address",
            },
          },
          type: "object",
          required: ["new_admin"],
        },
      },
      additionalProperties: false,
    },
    update_pool: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            backstop_take_rate: {
              $ref: "#/definitions/U32",
            },
            max_positions: {
              $ref: "#/definitions/U32",
            },
          },
          type: "object",
          required: ["backstop_take_rate", "max_positions"],
        },
      },
      additionalProperties: false,
    },
    queue_set_reserve: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            asset: {
              $ref: "#/definitions/Address",
            },
            metadata: {
              $ref: "#/definitions/ReserveConfig",
            },
          },
          type: "object",
          required: ["asset", "metadata"],
        },
      },
      additionalProperties: false,
    },
    cancel_set_reserve: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            asset: {
              $ref: "#/definitions/Address",
            },
          },
          type: "object",
          required: ["asset"],
        },
      },
      additionalProperties: false,
    },
    set_reserve: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            asset: {
              $ref: "#/definitions/Address",
            },
          },
          type: "object",
          required: ["asset"],
        },
      },
      additionalProperties: false,
    },
    get_positions: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            address: {
              $ref: "#/definitions/Address",
            },
          },
          type: "object",
          required: ["address"],
        },
      },
      additionalProperties: false,
    },
    submit: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            from: {
              $ref: "#/definitions/Address",
            },
            spender: {
              $ref: "#/definitions/Address",
            },
            to: {
              $ref: "#/definitions/Address",
            },
            requests: {
              type: "array",
              items: {
                $ref: "#/definitions/Request",
              },
            },
          },
          type: "object",
          required: ["from", "spender", "to", "requests"],
        },
      },
      additionalProperties: false,
    },
    bad_debt: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            user: {
              $ref: "#/definitions/Address",
            },
          },
          type: "object",
          required: ["user"],
        },
      },
      additionalProperties: false,
    },
    update_status: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {},
          type: "object",
        },
      },
      additionalProperties: false,
    },
    set_status: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            pool_status: {
              $ref: "#/definitions/U32",
            },
          },
          type: "object",
          required: ["pool_status"],
        },
      },
      additionalProperties: false,
    },
    gulp_emissions: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {},
          type: "object",
        },
      },
      additionalProperties: false,
    },
    set_emissions_config: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            res_emission_metadata: {
              type: "array",
              items: {
                $ref: "#/definitions/ReserveEmissionMetadata",
              },
            },
          },
          type: "object",
          required: ["res_emission_metadata"],
        },
      },
      additionalProperties: false,
    },
    claim: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            from: {
              $ref: "#/definitions/Address",
            },
            reserve_token_ids: {
              type: "array",
              items: {
                $ref: "#/definitions/U32",
              },
            },
            to: {
              $ref: "#/definitions/Address",
            },
          },
          type: "object",
          required: ["from", "reserve_token_ids", "to"],
        },
      },
      additionalProperties: false,
    },
    new_liquidation_auction: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            user: {
              $ref: "#/definitions/Address",
            },
            percent_liquidated: {
              $ref: "#/definitions/U64",
            },
          },
          type: "object",
          required: ["user", "percent_liquidated"],
        },
      },
      additionalProperties: false,
    },
    get_auction: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            auction_type: {
              $ref: "#/definitions/U32",
            },
            user: {
              $ref: "#/definitions/Address",
            },
          },
          type: "object",
          required: ["auction_type", "user"],
        },
      },
      additionalProperties: false,
    },
    new_bad_debt_auction: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {},
          type: "object",
        },
      },
      additionalProperties: false,
    },
    new_interest_auction: {
      properties: {
        args: {
          additionalProperties: false,
          properties: {
            assets: {
              type: "array",
              items: {
                $ref: "#/definitions/Address",
              },
            },
          },
          type: "object",
          required: ["assets"],
        },
      },
      additionalProperties: false,
    },
    ReserveEmissionMetadata: {
      description: "Metadata for a pool's reserve emission configuration",
      properties: {
        res_index: {
          $ref: "#/definitions/U32",
        },
        res_type: {
          $ref: "#/definitions/U32",
        },
        share: {
          $ref: "#/definitions/U64",
        },
        additionalProperties: false,
      },
      required: ["res_index", "res_type", "share"],
      type: "object",
    },
    Request: {
      description: "A request a user makes against the pool",
      properties: {
        address: {
          $ref: "#/definitions/Address",
        },
        amount: {
          $ref: "#/definitions/I128",
        },
        request_type: {
          $ref: "#/definitions/U32",
        },
        additionalProperties: false,
      },
      required: ["address", "amount", "request_type"],
      type: "object",
    },
    Reserve: {
      description: "",
      properties: {
        asset: {
          $ref: "#/definitions/Address",
        },
        b_rate: {
          $ref: "#/definitions/I128",
        },
        b_supply: {
          $ref: "#/definitions/I128",
        },
        backstop_credit: {
          $ref: "#/definitions/I128",
        },
        c_factor: {
          $ref: "#/definitions/U32",
        },
        d_rate: {
          $ref: "#/definitions/I128",
        },
        d_supply: {
          $ref: "#/definitions/I128",
        },
        index: {
          $ref: "#/definitions/U32",
        },
        ir_mod: {
          $ref: "#/definitions/I128",
        },
        l_factor: {
          $ref: "#/definitions/U32",
        },
        last_time: {
          $ref: "#/definitions/U64",
        },
        max_util: {
          $ref: "#/definitions/U32",
        },
        scalar: {
          $ref: "#/definitions/I128",
        },
        additionalProperties: false,
      },
      required: [
        "asset",
        "b_rate",
        "b_supply",
        "backstop_credit",
        "c_factor",
        "d_rate",
        "d_supply",
        "index",
        "ir_mod",
        "l_factor",
        "last_time",
        "max_util",
        "scalar",
      ],
      type: "object",
    },
    Positions: {
      description:
        "A user / contracts position's with the pool, stored in the Reserve's decimals",
      properties: {
        collateral: {
          type: "array",
          items: {
            type: "array",
            items: [
              {
                $ref: "#/definitions/U32",
              },
              {
                $ref: "#/definitions/I128",
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        liabilities: {
          type: "array",
          items: {
            type: "array",
            items: [
              {
                $ref: "#/definitions/U32",
              },
              {
                $ref: "#/definitions/I128",
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        supply: {
          type: "array",
          items: {
            type: "array",
            items: [
              {
                $ref: "#/definitions/U32",
              },
              {
                $ref: "#/definitions/I128",
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        additionalProperties: false,
      },
      required: ["collateral", "liabilities", "supply"],
      type: "object",
    },
    PoolConfig: {
      description: "The pool's config",
      properties: {
        bstop_rate: {
          $ref: "#/definitions/U32",
        },
        max_positions: {
          $ref: "#/definitions/U32",
        },
        oracle: {
          $ref: "#/definitions/Address",
        },
        status: {
          $ref: "#/definitions/U32",
        },
        additionalProperties: false,
      },
      required: ["bstop_rate", "max_positions", "oracle", "status"],
      type: "object",
    },
    PoolEmissionConfig: {
      description: "The pool's emission config",
      properties: {
        config: {
          $ref: "#/definitions/U128",
        },
        last_time: {
          $ref: "#/definitions/U64",
        },
        additionalProperties: false,
      },
      required: ["config", "last_time"],
      type: "object",
    },
    ReserveConfig: {
      description: "The configuration information about a reserve asset",
      properties: {
        c_factor: {
          $ref: "#/definitions/U32",
        },
        decimals: {
          $ref: "#/definitions/U32",
        },
        index: {
          $ref: "#/definitions/U32",
        },
        l_factor: {
          $ref: "#/definitions/U32",
        },
        max_util: {
          $ref: "#/definitions/U32",
        },
        r_base: {
          $ref: "#/definitions/U32",
        },
        r_one: {
          $ref: "#/definitions/U32",
        },
        r_three: {
          $ref: "#/definitions/U32",
        },
        r_two: {
          $ref: "#/definitions/U32",
        },
        reactivity: {
          $ref: "#/definitions/U32",
        },
        util: {
          $ref: "#/definitions/U32",
        },
        additionalProperties: false,
      },
      required: [
        "c_factor",
        "decimals",
        "index",
        "l_factor",
        "max_util",
        "r_base",
        "r_one",
        "r_three",
        "r_two",
        "reactivity",
        "util",
      ],
      type: "object",
    },
    QueuedReserveInit: {
      description: "",
      properties: {
        new_config: {
          $ref: "#/definitions/ReserveConfig",
        },
        unlock_time: {
          $ref: "#/definitions/U64",
        },
        additionalProperties: false,
      },
      required: ["new_config", "unlock_time"],
      type: "object",
    },
    ReserveData: {
      description: "The data for a reserve asset",
      properties: {
        b_rate: {
          $ref: "#/definitions/I128",
        },
        b_supply: {
          $ref: "#/definitions/I128",
        },
        backstop_credit: {
          $ref: "#/definitions/I128",
        },
        d_rate: {
          $ref: "#/definitions/I128",
        },
        d_supply: {
          $ref: "#/definitions/I128",
        },
        ir_mod: {
          $ref: "#/definitions/I128",
        },
        last_time: {
          $ref: "#/definitions/U64",
        },
        additionalProperties: false,
      },
      required: [
        "b_rate",
        "b_supply",
        "backstop_credit",
        "d_rate",
        "d_supply",
        "ir_mod",
        "last_time",
      ],
      type: "object",
    },
    ReserveEmissionsConfig: {
      description:
        "The configuration of emissions for the reserve b or d token\n\n`@dev` If this is updated, ReserveEmissionsData MUST also be updated",
      properties: {
        eps: {
          $ref: "#/definitions/U64",
        },
        expiration: {
          $ref: "#/definitions/U64",
        },
        additionalProperties: false,
      },
      required: ["eps", "expiration"],
      type: "object",
    },
    ReserveEmissionsData: {
      description: "The emission data for the reserve b or d token",
      properties: {
        index: {
          $ref: "#/definitions/I128",
        },
        last_time: {
          $ref: "#/definitions/U64",
        },
        additionalProperties: false,
      },
      required: ["index", "last_time"],
      type: "object",
    },
    UserEmissionData: {
      description: "The user emission data for the reserve b or d token",
      properties: {
        accrued: {
          $ref: "#/definitions/I128",
        },
        index: {
          $ref: "#/definitions/I128",
        },
        additionalProperties: false,
      },
      required: ["accrued", "index"],
      type: "object",
    },
    UserReserveKey: {
      description: "",
      properties: {
        reserve_id: {
          $ref: "#/definitions/U32",
        },
        user: {
          $ref: "#/definitions/Address",
        },
        additionalProperties: false,
      },
      required: ["reserve_id", "user"],
      type: "object",
    },
    AuctionKey: {
      description: "",
      properties: {
        auct_type: {
          $ref: "#/definitions/U32",
        },
        user: {
          $ref: "#/definitions/Address",
        },
        additionalProperties: false,
      },
      required: ["auct_type", "user"],
      type: "object",
    },
    PoolDataKey: {
      oneOf: [
        {
          type: "object",
          title: "ResConfig",
          properties: {
            tag: "ResConfig",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/Address",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
        {
          type: "object",
          title: "ResInit",
          properties: {
            tag: "ResInit",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/Address",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
        {
          type: "object",
          title: "ResData",
          properties: {
            tag: "ResData",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/Address",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
        {
          type: "object",
          title: "EmisConfig",
          properties: {
            tag: "EmisConfig",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/U32",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
        {
          type: "object",
          title: "EmisData",
          properties: {
            tag: "EmisData",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/U32",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
        {
          type: "object",
          title: "Positions",
          properties: {
            tag: "Positions",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/Address",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
        {
          type: "object",
          title: "UserEmis",
          properties: {
            tag: "UserEmis",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/UserReserveKey",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
        {
          type: "object",
          title: "Auction",
          properties: {
            tag: "Auction",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/AuctionKey",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
        {
          type: "object",
          title: "AuctData",
          properties: {
            tag: "AuctData",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/Address",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
      ],
    },
    PriceData: {
      description: "Price data for an asset at a specific timestamp",
      properties: {
        price: {
          $ref: "#/definitions/I128",
        },
        timestamp: {
          $ref: "#/definitions/U64",
        },
        additionalProperties: false,
      },
      required: ["price", "timestamp"],
      type: "object",
    },
    Asset: {
      oneOf: [
        {
          type: "object",
          title: "Stellar",
          properties: {
            tag: "Stellar",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/Address",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
        {
          type: "object",
          title: "Other",
          properties: {
            tag: "Other",
            values: {
              type: "array",
              items: [
                {
                  $ref: "#/definitions/ScSymbol",
                },
              ],
            },
          },
          required: ["tag", "values"],
          additionalProperties: false,
        },
      ],
      description: "Asset type",
    },
  },
};

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

const getExecutable = (
  contractLedgerEntryData: string,
  network: NetworkNames
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
  network: NetworkNames
) => {
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr } = Sdk;
  const contractCodeWasmHash = executable.wasmHash();
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

const getContractSpec = async (
  contractId: string,
  network: NetworkNames,
  logger: Logger
) => {
  try {
    const Sdk = getSdk(StellarSdkNext.Networks[network]);
    const { xdr } = Sdk;

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
