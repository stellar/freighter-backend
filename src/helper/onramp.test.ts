import jwt from "jsonwebtoken";
import { fetchOnrampSessionToken, isLikelyInternalIp } from "./onramp";

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

  it("forwards clientIp into the Coinbase request body", async () => {
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

  it("attaches an AbortSignal so the outbound fetch can time out", async () => {
    await fetchOnrampSessionToken({
      address: "GFOO",
      clientIp: "203.0.113.42",
      coinbaseConfig,
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces Coinbase's response body in the top-level error on 4xx", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid clientIp"}',
    });

    const result = await fetchOnrampSessionToken({
      address: "GFOO",
      clientIp: "10.0.0.1",
      coinbaseConfig,
    });

    expect(result.data.token).toBe("");
    expect(result.error).toMatch(/Coinbase 400/);
    expect(result.error).toMatch(/invalid clientIp/);
  });
});

describe("isLikelyInternalIp", () => {
  it.each([
    ["::1"],
    ["127.0.0.1"],
    ["10.0.0.1"],
    ["10.255.255.255"],
    ["172.16.0.1"],
    ["172.22.89.212"],
    ["172.31.255.255"],
    ["192.168.1.1"],
    ["169.254.1.1"],
    ["fe80::1"],
    ["fc00::1"],
    ["fd12:3456:789a::1"],
    ["::ffff:10.0.0.1"],
    [""],
  ])("classifies %s as internal", (ip) => {
    expect(isLikelyInternalIp(ip)).toBe(true);
  });

  it.each([
    ["8.8.8.8"],
    ["203.0.113.42"],
    ["172.15.0.1"],
    ["172.32.0.1"],
    ["1.1.1.1"],
    ["2001:db8::1"],
  ])("classifies %s as public", (ip) => {
    expect(isLikelyInternalIp(ip)).toBe(false);
  });
});
