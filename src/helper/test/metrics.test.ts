import { httpLabelUrl } from "../metrics";

describe("httpLabelUrl", () => {
  it("should return an account-history label for relevant routes", () => {
    const network = "PUBLIC";
    const route = "account-history";
    const labels = httpLabelUrl(`/api/v1/${route}?network=${network}`);
    expect(labels.network).toEqual(network);
    expect(labels.route).toEqual(route);
  });
  it("should return an account-balances label for relevant routes", () => {
    const network = "TESTNET";
    const route = "account-balances";
    const labels = httpLabelUrl(`/api/v1/${route}?network=${network}`);
    expect(labels.network).toEqual(network);
    expect(labels.route).toEqual(route);
  });
  it("should return the full URL in fall through cases", () => {
    const route = "some-route";
    const labels = httpLabelUrl(`/api/v1/${route}`);
    expect(labels.network).toEqual("unknown");
    expect(labels.route).toEqual(`/api/v1/${route}`);
  });
});
