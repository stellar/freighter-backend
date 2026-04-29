import jwt from "jsonwebtoken";
import { fetchOnrampSessionToken } from "./onramp";

const coinbaseConfig = {
  coinbaseApiKey: "test-key",
  coinbaseApiSecret: "test-secret",
};

describe("fetchOnrampSessionToken", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.spyOn(jwt, "sign").mockReturnValue("test-jwt" as any);
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "test-token" }),
    });
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("forwards clientIp into the Coinbase request body when provided", async () => {
    await fetchOnrampSessionToken({
      address: "GFOO",
      clientIp: "203.0.113.42",
      coinbaseConfig,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body).toEqual({
      addresses: [
        { address: "GFOO", blockchains: ["stellar"], assets: ["XLM"] },
      ],
      clientIp: "203.0.113.42",
    });
  });

  it("omits clientIp from the body when not provided", async () => {
    await fetchOnrampSessionToken({
      address: "GFOO",
      coinbaseConfig,
    });

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body).not.toHaveProperty("clientIp");
    expect(body.addresses).toEqual([
      { address: "GFOO", blockchains: ["stellar"], assets: ["XLM"] },
    ]);
  });

  it("omits clientIp from the body when passed an empty string", async () => {
    await fetchOnrampSessionToken({
      address: "GFOO",
      clientIp: "",
      coinbaseConfig,
    });

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body).not.toHaveProperty("clientIp");
  });
});
