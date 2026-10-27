import { Account, MuxedAccount } from "stellar-sdk";

import { muxedContractFixture, pubKey } from "./test-helper";
import { isContractId, isTransferAddress } from "./validate";

describe("validate", () => {
  const G_ADDR = pubKey;
  const M_ADDR = new MuxedAccount(new Account(G_ADDR, "1"), "123").accountId();
  const C_ADDR = muxedContractFixture.contractId;
  const W_ADDR = muxedContractFixture.muxed;

  describe("isTransferAddress", () => {
    it.each([G_ADDR, M_ADDR, C_ADDR, W_ADDR])("accepts %s", (address) => {
      expect(isTransferAddress(address)).toBe(true);
    });

    it.each([
      "",
      "not an address",
      W_ADDR.slice(0, -1),
      "SBGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O34RMTB343OYPXU5DJDVMN",
    ])("rejects %p", (address) => {
      expect(isTransferAddress(address)).toBe(false);
    });
  });

  describe("isContractId", () => {
    it("accepts a C address", () => {
      expect(isContractId(C_ADDR)).toBe(true);
    });

    it("rejects a W address so contract-keyed endpoints stay C only", () => {
      expect(isContractId(W_ADDR)).toBe(false);
    });
  });
});
