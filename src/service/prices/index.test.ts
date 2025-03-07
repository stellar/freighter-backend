import { PriceClient } from "./index";
import { testLogger } from "../../helper/test-helper";
import { TokenPriceData } from "./types";
import BigNumber from "bignumber.js";

describe("Token Prices Service", () => {
  let priceClient: PriceClient;
  const mockRedisClient: any = {
    ts: {
      get: jest.fn(),
      range: jest.fn(),
    },
    zIncrBy: jest.fn(),
  };

  beforeEach(() => {
    priceClient = new PriceClient(testLogger, mockRedisClient);
    jest.clearAllMocks();
    jest.spyOn(testLogger, "error");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("getPrice should return current price data", async () => {
    // Setup mock Redis responses
    const mockCurrentPrice = 50000;
    const mockTimestamp = Date.now();

    // Mock ts.get to return current price data
    mockRedisClient.ts.get.mockResolvedValue({
      timestamp: mockTimestamp,
      value: mockCurrentPrice,
    });

    // Mock ts.range to return historical price data
    mockRedisClient.ts.range.mockResolvedValue([
      {
        timestamp: mockTimestamp - 24 * 60 * 60 * 1000, // 24h ago
        value: 45000,
      },
    ]);

    // Call the method being tested
    const token =
      "BTC:GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM";
    const result = await priceClient.getPrice(token);

    // Verify the result
    expect(result).not.toBeNull();
    expect(result?.currentPrice.toNumber()).toBe(mockCurrentPrice);
    expect(result?.percentagePriceChange24h?.toFixed(2)).toBe("11.11"); // (50000-45000)/45000*100 ≈ 11.11%

    // Verify Redis client was called correctly
    expect(mockRedisClient.ts.get).toHaveBeenCalledWith(token);
    expect(mockRedisClient.ts.range).toHaveBeenCalled();
    expect(mockRedisClient.zIncrBy).toHaveBeenCalledWith(
      expect.any(String),
      1,
      token,
    );
  });

  it("getPrice should handle missing historical data", async () => {
    // Setup mock - current price exists but no historical data
    mockRedisClient.ts.get.mockResolvedValue({
      timestamp: Date.now(),
      value: 50000,
    });

    // Empty array means no historical data found
    mockRedisClient.ts.range.mockResolvedValue([]);

    const token =
      "BTC:GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM";
    const result = await priceClient.getPrice(token);

    // Should return current price but no percentage change
    expect(result).not.toBeNull();
    expect(result?.currentPrice.toNumber()).toBe(50000);
    expect(result?.percentagePriceChange24h).toBeNull();
  });

  it("getPrice should handle missing token", async () => {
    // Setup mock - ts.get throws error for non-existent key
    mockRedisClient.ts.get.mockRejectedValue(new Error("Key does not exist"));

    // Spy on handleMissingToken method
    const handleMissingTokenSpy = jest.spyOn(
      priceClient as any,
      "handleMissingToken",
    );
    handleMissingTokenSpy.mockResolvedValue({
      currentPrice: new BigNumber(60000),
      percentagePriceChange24h: null,
    } as TokenPriceData);

    const token = "NONEXISTENT:TOKEN";
    const result = await priceClient.getPrice(token);

    // Should call handleMissingToken and return its result
    expect(handleMissingTokenSpy).toHaveBeenCalledWith(token);
    expect(result).not.toBeNull();
    expect(result?.currentPrice.toNumber()).toBe(60000);
  });

  it("getPrice handles errors", async () => {
    // Setup mock - ts.get throws error
    mockRedisClient.ts.get.mockResolvedValue({
      timestamp: Date.now(),
      value: 50000,
    });
    mockRedisClient.ts.range.mockRejectedValue(
      new Error("24h price data not found"),
    );

    const token =
      "BTC:GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM";
    const result = await priceClient.getPrice(token);
    expect(result).toBeNull();
    expect(testLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          `getting price from time series for ${token}`,
        ),
      }),
    );
  });
});
