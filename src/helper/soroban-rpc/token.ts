import * as StellarSdkNext from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";
import { NetworkNames } from "../validate";
import { Logger } from "pino";
import { getSdk } from "../stellar";
import { getContractSpec, getServer, simulateTx } from "./network";
import { StellarRpcConfig } from "../../config";

// https://github.com/stellar/soroban-examples/blob/main/token/src/contract.rs
enum SorobanTokenInterface {
  transfer = "transfer",
  mint = "mint",
}

const TOKEN_SPEC_DEFINITIONS: { [index: string]: any } = {
  allowance: {
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
        },
        type: "object",
        required: ["from", "spender"],
      },
    },
    additionalProperties: false,
  },
  approve: {
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
          amount: {
            $ref: "#/definitions/I128",
          },
          expiration_ledger: {
            $ref: "#/definitions/U32",
          },
        },
        type: "object",
        required: ["from", "spender", "amount", "expiration_ledger"],
      },
    },
    additionalProperties: false,
  },
  balance: {
    properties: {
      args: {
        additionalProperties: false,
        properties: {
          id: {
            $ref: "#/definitions/Address",
          },
        },
        type: "object",
        required: ["id"],
      },
    },
    additionalProperties: false,
  },
  transfer: {
    properties: {
      args: {
        additionalProperties: false,
        properties: {
          from: {
            $ref: "#/definitions/Address",
          },
          to: {
            $ref: "#/definitions/Address",
          },
          amount: {
            $ref: "#/definitions/I128",
          },
        },
        type: "object",
        required: ["from", "to", "amount"],
      },
    },
    additionalProperties: false,
  },
  transfer_from: {
    properties: {
      args: {
        additionalProperties: false,
        properties: {
          spender: {
            $ref: "#/definitions/Address",
          },
          from: {
            $ref: "#/definitions/Address",
          },
          to: {
            $ref: "#/definitions/Address",
          },
          amount: {
            $ref: "#/definitions/I128",
          },
        },
        type: "object",
        required: ["spender", "from", "to", "amount"],
      },
    },
    additionalProperties: false,
  },
  burn: {
    properties: {
      args: {
        additionalProperties: false,
        properties: {
          from: {
            $ref: "#/definitions/Address",
          },
          amount: {
            $ref: "#/definitions/I128",
          },
        },
        type: "object",
        required: ["from", "amount"],
      },
    },
    additionalProperties: false,
  },
  burn_from: {
    properties: {
      args: {
        additionalProperties: false,
        properties: {
          spender: {
            $ref: "#/definitions/Address",
          },
          from: {
            $ref: "#/definitions/Address",
          },
          amount: {
            $ref: "#/definitions/I128",
          },
        },
        type: "object",
        required: ["spender", "from", "amount"],
      },
    },
    additionalProperties: false,
  },
  decimals: {
    properties: {
      args: {
        additionalProperties: false,
        properties: {},
        type: "object",
      },
    },
    additionalProperties: false,
  },
  name: {
    properties: {
      args: {
        additionalProperties: false,
        properties: {},
        type: "object",
      },
    },
    additionalProperties: false,
  },
  symbol: {
    properties: {
      args: {
        additionalProperties: false,
        properties: {},
        type: "object",
      },
    },
    additionalProperties: false,
  },
};

const getTokenDecimals = async (
  contractId: string,
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server,
  builder: StellarSdk.TransactionBuilder,
  network: NetworkNames,
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
    StellarSdkNext.Networks[network],
  );
  return result;
};

const getTokenName = async (
  contractId: string,
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server,
  builder: StellarSdk.TransactionBuilder,
  network: NetworkNames,
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
    StellarSdkNext.Networks[network],
  );
  return result;
};

const getTokenSymbol = async (
  contractId: string,
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server,
  builder: StellarSdk.TransactionBuilder,
  network: NetworkNames,
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
    StellarSdkNext.Networks[network],
  );
  return result;
};

const getTokenBalance = async (
  contractId: string,
  params: StellarSdk.xdr.ScVal[],
  server: StellarSdk.SorobanRpc.Server | StellarSdkNext.SorobanRpc.Server,
  builder: StellarSdk.TransactionBuilder,
  network: NetworkNames,
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
    StellarSdkNext.Networks[network],
  );
  return result;
};

const buildTransfer = (
  contractId: string,
  params: StellarSdk.xdr.ScVal[],
  memo: string | undefined,
  builder: StellarSdk.TransactionBuilder,
  networkPassphrase: StellarSdk.Networks,
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

const getIsTokenSpec = async (
  contractId: string,
  network: NetworkNames,
  logger: Logger,
  stellarRpcConfig: StellarRpcConfig,
) => {
  try {
    const spec = await getContractSpec(
      contractId,
      network,
      logger,
      stellarRpcConfig,
    );
    if (spec.error) {
      throw new Error(spec.error);
    }
    const res = isTokenSpec(spec.result!);
    return res;
  } catch (error) {
    return false;
  }
};

const isTokenSpec = (spec: Record<string, any>) => {
  for (const tokenMethod of Object.keys(TOKEN_SPEC_DEFINITIONS)) {
    const specMethod = spec.definitions[tokenMethod];
    if (
      !specMethod ||
      JSON.stringify(specMethod) !==
        JSON.stringify(TOKEN_SPEC_DEFINITIONS[tokenMethod])
    ) {
      return false;
    }
  }
  return true;
};

const isSacContractExecutable = async (
  contractId: string,
  network: NetworkNames,
  stellarRpcConfig: StellarRpcConfig,
) => {
  // verify the contract executable in the instance entry
  // The SAC has a unique contract executable type
  const Sdk = getSdk(StellarSdkNext.Networks[network]);
  const { xdr } = Sdk;

  const server = await getServer(network, stellarRpcConfig);
  const instance = new Sdk.Contract(contractId).getFootprint();
  const ledgerKeyContractCode = instance.toXDR("base64");

  const { entries } = await server.getLedgerEntries(
    xdr.LedgerKey.fromXDR(ledgerKeyContractCode, "base64"),
  );

  if (entries && entries.length) {
    const parsed = entries[0].val;
    const executable = parsed.contractData().val().instance().executable();

    return (
      executable.switch().name ===
      xdr.ContractExecutableType.contractExecutableStellarAsset().name
    );
  }

  return false;
};

const isSacContract = (
  name: string,
  contractId: string,
  network: StellarSdk.Networks,
) => {
  const Sdk = getSdk(network);
  if (name.includes(":")) {
    try {
      return (
        new Sdk.Asset(...(name.split(":") as [string, string])).contractId(
          network,
        ) === contractId
      );
    } catch (error) {
      return false;
    }
  }

  return false;
};

const getOpArgs = (
  fnName: string,
  args: StellarSdk.xdr.ScVal[],
  network: NetworkNames,
) => {
  const Sdk = getSdk(StellarSdk.Networks[network]);

  let amount: number;
  let from;
  let to;

  switch (fnName) {
    case SorobanTokenInterface.transfer:
      from = Sdk.StrKey.encodeEd25519PublicKey(
        args[0].address().accountId().ed25519(),
      );
      to = Sdk.StrKey.encodeEd25519PublicKey(
        args[1].address().accountId().ed25519(),
      );
      amount = Sdk.scValToNative(args[2]).toString();
      break;
    case SorobanTokenInterface.mint:
      to = Sdk.StrKey.encodeEd25519PublicKey(
        args[0].address().accountId().ed25519(),
      );
      amount = Sdk.scValToNative(args[1]).toString();
      break;
    default:
      amount = 0;
  }

  return { from, to, amount };
};

export {
  buildTransfer,
  getIsTokenSpec,
  getOpArgs,
  getTokenBalance,
  getTokenDecimals,
  getTokenName,
  getTokenSymbol,
  isSacContract,
  isSacContractExecutable,
  isTokenSpec,
  SorobanTokenInterface,
  TOKEN_SPEC_DEFINITIONS,
};
