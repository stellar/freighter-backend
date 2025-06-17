import { httpLabelUrl } from "../metrics";

describe("httpLabelUrl", () => {
  it("should return an account-history label for relevant routes", () => {
    const network = "PUBLIC";
    const route = "account-history";
    const labels = httpLabelUrl(
      `/api/v1/${route}/GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3?network=${network}`,
    );
    expect(labels.network).toEqual(network);
    expect(labels.route).toEqual(`/${route}`);
  });

  it("should return an account-balances label for relevant routes", () => {
    const network = "TESTNET";
    const route = "account-balances";
    const labels = httpLabelUrl(
      `/api/v1/${route}/GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3?network=${network}`,
    );
    expect(labels.network).toEqual(network);
    expect(labels.route).toEqual(`/${route}`);
  });

  it("should return token-details label for token-details routes", () => {
    const network = "PUBLIC";
    const labels = httpLabelUrl(
      `/api/v1/token-details/CCLDLQF3AYCOKUWYIAFCKX2VBHM4FPCKPOH7IPHC3QPWYF2NAVFKM7RG?network=${network}`,
    );
    expect(labels.network).toEqual(network);
    expect(labels.route).toEqual("/token-details");
  });

  it("should handle routes without /api/v1 prefix", () => {
    const labels = httpLabelUrl("/ping");
    expect(labels.network).toEqual("unknown");
    expect(labels.route).toEqual("/ping");
  });

  it("should handle whitelisted routes without parameters", () => {
    const network = "TESTNET";
    const labels = httpLabelUrl(`/api/v1/scan-tx?network=${network}`);
    expect(labels.network).toEqual(network);
    expect(labels.route).toEqual("/scan-tx");
  });

  it("should return 'other' for spam URLs", () => {
    const labels = httpLabelUrl("/nagvis/frontend/nagvis-js/index.php");
    expect(labels.network).toEqual("unknown");
    expect(labels.route).toEqual("other");
  });

  it("should handle missing network parameter", () => {
    const labels = httpLabelUrl("/api/v1/rpc-health");
    expect(labels.network).toEqual("unknown");
    expect(labels.route).toEqual("/rpc-health");
  });
});
