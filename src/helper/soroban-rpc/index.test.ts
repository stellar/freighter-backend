import { xdr } from "stellar-sdk";

import { base64regex, testLogger } from "../test-helper";
import * as networkHelpers from "./network";
import { getIsTokenSpec, isTokenSpec } from "./token";

const { getLedgerKeyContractCode, getLedgerKeyWasmId, parseWasmXdr } =
  networkHelpers;

describe("Soroban RPC helpers", () => {
  const CONTRACT_ID =
    "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
  const contractWasmXdr =
    "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AEEQaiABQj+HNwMAIAAgAUIIhzcDCAwCCyAAQoOQgICAATcDCEIBIQEMAgsgARCGgICAACEDIAEQh4CAgAAhASAAQRBqIAM3AwAgACABNwMIC0IAIQELIAAgATcDAAsMABCMgICAAEIgiKcLjwIBAn8jgICAgABB0ABrIgUkgICAgAACQCACQgBSIANCAFUgA1AbIgZFDQAQnYCAgAAgBE0NABCfgICAAAALIAVBEGpBEGogATcDACAFIAA3AxggBUIANwMQIAVBKGpBEGogATcDACAFIAA3AzAgBUIANwMoIAVBKGoQkYCAgAAhASAFIAIgAxCggICAACAFIAStQiCGQgSENwNIIAUgBSkDCDcDQCABQbCBwIAAQQIgBUHAAGpBAhCTgICAAEIAEIKAgIAAGgJAIAZFDQACQCAEEJ2AgIAAIgZPDQBBgIDAgABBKxCYgICAAAALIAVBEGpCACAEIAZrIgQgBBCQgICAAAsgBUHQAGokgICAgAALBAAAAAtbAAJAAkAgAUKAgICAgICAwAB8Qv//////////AFYNACABIAGFIAFCP4cgAoWEQgBSDQAgAUIIhkILhCEBDAELIAIgARCIgICAACEBCyAAIAE3AwggAEIANwMAC5IBBAF/AX4BfwF+I4CAgIAAQSBrIgQkgICAgAAgBEEIaiAAIAEQmoCAgAACQCAEKQMIIgUgAlQiBiAEQRBqKQMAIgcgA1MgByADURsNAAJAIAJCAFIgA0IAVSADUBtFDQAgACABIAUgAn0gByADfSAGrX0gBCgCGBCegICAAAsgBEEgaiSAgICAAA8LEJ+AgIAAAAubAQIBfwJ+I4CAgIAAQTBrIgIkgICAgAAgAkIBNwMAIAIgATcDCEIAIQFCACEDAkACQCACEJGAgIAAIgRCARCXgICAAEUNACACQRhqIARCARCBgICAABCcgICAACACKQMYUEUNASACQShqKQMAIQMgAikDICEBIAIQj4CAgAALIAAgAzcDCCAAIAE3AwAgAkEwaiSAgICAAA8LAAALZQEBfyOAgICAAEEwayIDJICAgIAAIANCATcDGCADIAA3AyAgA0EYahCRgICAACEAIANBCGogASACEKCAgIAAIAAgAykDEEIBEIKAgIAAGiADQRhqEI+AgIAAIANBMGokgICAgAALfAIBfwF+I4CAgIAAQRBrIgMkgICAgAAgAyAAEKKAgIAAAkAgA0EIaikDACIEIAKFQn+FIAQgBCACfCADKQMAIgIgAXwiASACVK18IgKFg0IAUw0AIAAgASACEKOAgIAAIANBEGokgICAgAAPC0HggMCAAEEcEJiAgIAAAAuVAQQBfwF+AX8BfiOAgICAAEEQayIDJICAgIAAIAMgABCigICAAAJAAkAgAykDACIEIAFUIgUgA0EIaikDACIGIAJTIAYgAlEbDQAgBiAChSAGIAYgAn0gBa19IgKFg0IAWQ0BQbCAwIAAQSEQmICAgAAACxCfgICAAAALIAAgBCABfSACEKOAgIAAIANBEGokgICAgAALFAACQCABQgBTDQAPCxCfgICAAAAL1gEBAX8jgICAgABBIGsiBCSAgICAAAJAAkAgAEL/AYNCzQBSDQAgAUL/AYNCBFINACACQv8Bg0LJAFINACADQv8Bg0LJAFINACAEQgM3AwggBEEIahCRgICAAEICEJeAgIAADQEgABCZgICAACABQiCIp0ESSw0BIAQgAzcDGCAEIAI3AxAgBCABQoCAgIBwg0IEhDcDCEKOmJ/mw/nBMEH0gcCAAEEDIARBCGpBAxCTgICAAEICEIKAgIAAGiAEQSBqJICAgIAAQgIPCwAACxCfgICAAAALxwECAX8CfiOAgICAAEEwayICJICAgIAAAkAgAEL/AYNCzQBSDQAgAkEYaiABEJyAgIAAIAIpAxhQRQ0AIAIpAyAiASACQShqKQMAIgMQpoCAgAAQloCAgAAiBBCDgICAABoQqYCAgAAgACABIAMQpICAgAAgAiAANwMoIAIgBDcDICACQo7ys9cMNwMYIAJBGGoQqoCAgAAhACACQQhqIAEgAxCggICAACAAIAIpAxAQhICAgAAaIAJBMGokgICAgABCAg8LAAALGwBChICAgICg5QBChICAgICQ9gAQjoCAgAAaC6YBAgF/AX4jgICAgABBMGsiASSAgICAACABIAApAxA3AxAgASAAKQMINwMIIAEgACkDADcDAEEAIQADfgJAIABBGEcNAEEAIQACQANAIABBGEYNASABQRhqIABqIAEgAGopAwA3AwAgAEEIaiEADAALCyABQRhqQQMQlYCAgAAhAiABQTBqJICAgIAAIAIPCyABQRhqIABqQgI3AwAgAEEIaiEADAALC08BAX4CQCAAQv8Bg0LNAFENAAAACxCWgICAACIBEIOAgIAAGhCpgICAACAAEJmAgIAAQo7mrrnqjOTVOCABEKyAgIAAIAAQhICAgAAaQgILlAEBAn8jgICAgABBIGsiAiSAgICAACACIAE3AwggAiAANwMAQQAhAwN+AkAgA0EQRw0AQQAhAwJAA0AgA0EQRg0BIAJBEGogA2ogAiADaikDADcDACADQQhqIQMMAAsLIAJBEGpBAhCVgICAACEBIAJBIGokgICAgAAgAQ8LIAJBEGogA2pCAjcDACADQQhqIQMMAAsLdAEBfyOAgICAAEEwayICJICAgIAAAkAgAEL/AYNCzQBSDQAgAUL/AYNCzQBSDQAQqYCAgAAgAkEYaiAAIAEQmoCAgAAgAkEIaiACKQMYIAJBIGopAwAQoICAgAAgAikDECEAIAJBMGokgICAgAAgAA8LAAALlQICAX8CfiOAgICAAEHAAGsiBCSAgICAAAJAIABC/wGDQs0AUg0AIAFC/wGDQs0AUg0AIARBGGogAhCcgICAACAEKQMYUEUNACADQv8Bg0IEUg0AIARBKGopAwAhAiAEKQMgIQUgABCDgICAABogBSACEKaAgIAAEKmAgIAAIAAgASAFIAIgA0IgiKcQnoCAgABB2oHAgABBBxCSgICAACEGIAQgATcDKCAEIAA3AyAgBCAGNwMYIARBGGoQqoCAgAAhACAEQQhqIAUgAhCggICAACAEIANCgICAgHCDQgSENwM4IAQgBCkDEDcDMCAAIARBMGpBAhCVgICAABCEgICAABogBEHAAGokgICAgABCAg8LAAALYgEBfyOAgICAAEEgayIBJICAgIAAAkAgAEL/AYNCzQBRDQAAAAsQqYCAgAAgAUEQaiAAEKKAgIAAIAEgASkDECABQRhqKQMAEKCAgIAAIAEpAwghACABQSBqJICAgIAAIAALqAECAX8BfiOAgICAAEEgayIDJICAgIAAAkAgAEL/AYNCzQBSDQAgAUL/AYNCzQBSDQAgA0EIaiACEJyAgIAAIAMpAwhQRQ0AIANBGGopAwAhAiADKQMQIQQgABCDgICAABogBCACEKaAgIAAEKmAgIAAIAAgBCACEKWAgIAAIAEgBCACEKSAgIAAIAAgASAEIAIQsYCAgAAgA0EgaiSAgICAAEICDwsAAAtnAQF/I4CAgIAAQTBrIgQkgICAgAAgBCABNwMoIAQgADcDICAEQo7u6pW+tt7zADcDGCAEQRhqEKqAgIAAIQEgBEEIaiACIAMQoICAgAAgASAEKQMQEISAgIAAGiAEQTBqJICAgIAAC8IBAgF/AX4jgICAgABBIGsiBCSAgICAAAJAIABC/wGDQs0AUg0AIAFC/wGDQs0AUg0AIAJC/wGDQs0AUg0AIARBCGogAxCcgICAACAEKQMIUEUNACAEQRhqKQMAIQMgBCkDECEFIAAQg4CAgAAaIAUgAxCmgICAABCpgICAACABIAAgBSADEKGAgIAAIAEgBSADEKWAgIAAIAIgBSADEKSAgIAAIAEgAiAFIAMQsYCAgAAgBEEgaiSAgICAAEICDwsAAAuOAQIBfwF+I4CAgIAAQSBrIgIkgICAgAACQCAAQv8Bg0LNAFINACACQQhqIAEQnICAgAAgAikDCFBFDQAgAkEYaikDACEBIAIpAxAhAyAAEIOAgIAAGiADIAEQpoCAgAAQqYCAgAAgACADIAEQpYCAgAAgACADIAEQtICAgAAgAkEgaiSAgICAAEICDwsAAAtKAQF/I4CAgIAAQRBrIgMkgICAgABCjua3/QkgABCsgICAACEAIAMgASACEKCAgIAAIAAgAykDCBCEgICAABogA0EQaiSAgICAAAuoAQIBfwF+I4CAgIAAQSBrIgMkgICAgAACQCAAQv8Bg0LNAFINACABQv8Bg0LNAFINACADQQhqIAIQnICAgAAgAykDCFBFDQAgA0EYaikDACECIAMpAxAhBCAAEIOAgIAAGiAEIAIQpoCAgAAQqYCAgAAgASAAIAQgAhChgICAACABIAQgAhClgICAACABIAQgAhC0gICAACADQSBqJICAgIAAQgIPCwAAC3ECAX8BfiOAgICAAEEgayIAJICAgIAAAkACQEKOmJ/mw/nBMEICEJeAgIAARQ0AIABCjpif5sP5wTBCAhCBgICAABC3gICAACAAKQMAUA0BCwAACyAAQRhqNQIAIQEgAEEgaiSAgICAACABQiCGQgSEC/cBAgJ/An4jgICAgABBIGsiAiSAgICAAEEAIQMCQANAIANBGEYNASACQQhqIANqQgI3AwAgA0EIaiEDDAALCwJAAkACQAJAIAFC/wGDQswAUg0AIAFB9IHAgABBAyACQQhqQQMQm4CAgAAg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";

  describe("getLedgerKeyContractCode", () => {
    it("will return ledger key for contract code", () => {
      const ledgerKeyXdr = getLedgerKeyContractCode(CONTRACT_ID, "TESTNET");
      const ledgerKeyFromXdr = xdr.LedgerKey.fromXDR(ledgerKeyXdr, "base64");

      expect(typeof ledgerKeyXdr).toEqual("string");
      expect(base64regex.test(ledgerKeyXdr)).toBeTruthy();
      expect(ledgerKeyFromXdr).toBeInstanceOf(xdr.LedgerKey);
      expect(ledgerKeyFromXdr.switch().name).toEqual("contractData");
    });
    it("will throw when it fails to get ledger key", () => {
      expect(() =>
        getLedgerKeyContractCode("not contract ID", "TESTNET"),
      ).toThrowError();
    });
  });

  describe("getLedgerKeyWasmId", () => {
    const EXECTUABLE_XDR = "AAAAAGR7a8CMAj18oYkZKn4kqfBSa8oa0Mdoo294cHR1X2nw";
    const executable = xdr.ContractExecutable.fromXDR(EXECTUABLE_XDR, "base64");
    it("will return the contract code ledger key for a contract ID", () => {
      const ledgerKeyWasmId = getLedgerKeyWasmId(executable, "TESTNET");
      const ledgerKeyFromXdr = xdr.LedgerKey.fromXDR(ledgerKeyWasmId, "base64");

      expect(typeof ledgerKeyWasmId).toEqual("string");
      expect(base64regex.test(ledgerKeyWasmId)).toBeTruthy();
      expect(ledgerKeyFromXdr).toBeInstanceOf(xdr.LedgerKey);
      expect(ledgerKeyFromXdr.switch().name).toEqual("contractCode");
    });
  });

  describe("parseWasmXdr", () => {
    it("will return a json schema of a contract spec", async () => {
      const spec = await parseWasmXdr(contractWasmXdr, "TESTNET");
      expect(spec).toHaveProperty("definitions");
    });
  });

  describe("isTokenSpec", () => {
    it("will return a boolean indicating if the spec matches sep41 spec", async () => {
      const spec = await parseWasmXdr(contractWasmXdr, "TESTNET");
      const isSep41 = isTokenSpec(spec);

      expect(isSep41).toBeTruthy();
    });

    it("will return false when the spec does match sep41", async () => {
      const isSep41 = isTokenSpec({ definitions: {} });

      expect(isSep41).toBeFalsy();
    });
  });

  describe("getIsTokenSpec", () => {
    afterAll(() => {
      jest.resetModules();
    });
    it("will return false when the spec cannot be parsed", async () => {
      jest.spyOn(networkHelpers, "getContractSpec").mockImplementation(() => {
        return Promise.resolve({ result: { notDefinitions: {} }, error: null });
      });

      const mockConfig = {
        freighterRpcPubnetUrl: "http://mock-pubnet",
        freighterRpcTestnetUrl: "http://mock-testnet",
        freighterRpcFuturenetUrl: "http://mock-futurenet",
      };

      const isSep41 = await getIsTokenSpec(
        "contractId",
        "TESTNET",
        testLogger,
        mockConfig,
      );

      expect(isSep41).toBeFalsy();
    });
  });
});
