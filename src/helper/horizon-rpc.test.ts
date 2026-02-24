import * as StellarSdk from "stellar-sdk";
import { NETWORK_URLS } from "./horizon-rpc";

const mockSubmitTransaction = jest.fn();
const mockFromXDR = jest.fn().mockReturnValue({ fake: "transaction" });

let capturedServerUrl: string | undefined;

jest.mock("./stellar", () => ({
  getSdk: () => ({
    TransactionBuilder: {
      fromXDR: mockFromXDR,
    },
    Horizon: {
      Server: class MockServer {
        constructor(url: string) {
          capturedServerUrl = url;
        }
        submitTransaction = mockSubmitTransaction;
      },
    },
  }),
}));

// Import after mocks are set up
import { submitTransaction } from "./horizon-rpc";

describe("submitTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedServerUrl = undefined;
  });

  describe("network passphrase validation", () => {
    it("rejects unknown network passphrase", async () => {
      const result = await submitTransaction("any-xdr", "bogus passphrase");
      expect(result.data).toBeNull();
      expect(result.error).toBe("Unknown network passphrase: bogus passphrase");
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it("rejects SANDBOX network (empty URL)", async () => {
      const result = await submitTransaction(
        "any-xdr",
        StellarSdk.Networks.SANDBOX,
      );
      expect(result.data).toBeNull();
      expect(result.error).toContain("Unsupported network");
      expect(result.error).toContain("SANDBOX");
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it("rejects STANDALONE network (empty URL)", async () => {
      const result = await submitTransaction(
        "any-xdr",
        StellarSdk.Networks.STANDALONE,
      );
      expect(result.data).toBeNull();
      expect(result.error).toContain("Unsupported network");
      expect(result.error).toContain("STANDALONE");
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });
  });

  describe("network URL derivation", () => {
    it("uses the PUBLIC Horizon URL for PUBLIC passphrase", async () => {
      mockSubmitTransaction.mockResolvedValueOnce({ hash: "abc" });

      const result = await submitTransaction(
        "any-xdr",
        StellarSdk.Networks.PUBLIC,
      );
      expect(result.data).toEqual({ hash: "abc" });
      expect(result.error).toBeNull();
      expect(capturedServerUrl).toBe(NETWORK_URLS.PUBLIC);
    });

    it("uses the TESTNET Horizon URL for TESTNET passphrase", async () => {
      mockSubmitTransaction.mockResolvedValueOnce({ hash: "def" });

      const result = await submitTransaction(
        "any-xdr",
        StellarSdk.Networks.TESTNET,
      );
      expect(result.data).toEqual({ hash: "def" });
      expect(result.error).toBeNull();
      expect(capturedServerUrl).toBe(NETWORK_URLS.TESTNET);
    });

    it("never uses an attacker-supplied URL", async () => {
      mockSubmitTransaction.mockResolvedValueOnce({ hash: "safe" });

      await submitTransaction("any-xdr", StellarSdk.Networks.PUBLIC);
      expect(capturedServerUrl).toBe("https://horizon.stellar.org");
    });
  });

  describe("retry behavior", () => {
    it("returns error data on non-504 failure without retrying", async () => {
      const errorData = { type: "tx_failed", title: "Transaction Failed" };
      mockSubmitTransaction.mockRejectedValueOnce({
        response: { status: 400, data: errorData },
      });

      const result = await submitTransaction(
        "any-xdr",
        StellarSdk.Networks.PUBLIC,
      );
      expect(result.data).toBeNull();
      expect(result.error).toEqual(errorData);
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    });

    it("retries on 504 and succeeds", async () => {
      mockSubmitTransaction
        .mockRejectedValueOnce({ response: { status: 504 } })
        .mockRejectedValueOnce({ response: { status: 504 } })
        .mockResolvedValueOnce({ hash: "retry_success" });

      const result = await submitTransaction(
        "any-xdr",
        StellarSdk.Networks.PUBLIC,
      );
      expect(result.data).toEqual({ hash: "retry_success" });
      expect(result.error).toBeNull();
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(3);
    });

    it("caps retries at 4 total attempts on repeated 504", async () => {
      mockSubmitTransaction.mockRejectedValue({
        response: { status: 504, data: { type: "timeout" } },
      });

      const result = await submitTransaction(
        "any-xdr",
        StellarSdk.Networks.PUBLIC,
      );
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ type: "timeout" });
      // 1 initial + 3 retries = 4 total
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(4);
    });

    it("returns null error when exception has no response data", async () => {
      mockSubmitTransaction.mockRejectedValueOnce(new Error("network error"));

      const result = await submitTransaction(
        "any-xdr",
        StellarSdk.Networks.PUBLIC,
      );
      expect(result.data).toBeNull();
      expect(result.error).toBeNull();
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
