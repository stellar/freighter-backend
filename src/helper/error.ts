export const ERROR = {
  ASSET_TYPE_NOT_SUPPORTED: "unknown asset type",
  ACCOUNT_NOT_SOURCE:
    "Transfer contains authorization entry for a different account",
  AUTH_SUB_INVOCATIONS:
    "Transfer authorizes sub-invocations to another contract",
  FAILED_TO_SIM: "Failed to simulate transaction",
  INVALID_ENV: (key: string) => `ENV configuration invalid - missing ${key}`,
  UNSUPPORTED_NETWORK: "network not supported",
  INVALID_SIMULATION: "Invalid response from simulateTransaction",
  INVALID_VALIDATOR_DEF: "Invalid definition for custom validator",
  TOKEN_SUB_FAILED: "Failed to subscribe to token events",
  SERVER_ERROR: "Unexpected server error",
  MISSING_SUB_FOR_PUBKEY:
    "Tried to query for data without a subscription setup for a public key",
  MISSING_SUB_FOR_TOKEN_BALANCE:
    "Tried to query for data without a subscription setup for a token balance",
  ENTRY_NOT_FOUND: {
    CONTRACT_CODE: "contract code entry not found",
  },
  INVALID_RUN_MODE: "invalid run mode",
  UNABLE_TO_SCAN_SITE: "unable to scan site using blockaid",
  UNABLE_TO_SCAN_TX: "unable to scan tx using blockaid",
  UNABLE_TO_SCAN_ASSET: "unable to scan asset using blockaid",
};
