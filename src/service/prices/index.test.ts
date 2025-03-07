import { PriceClient } from "./index";
import { testLogger } from "../../helper/test-helper";
import { TokenPriceData } from "./types";
import BigNumber from "bignumber.js";

describe("getPrice", () => {
  let priceClient: PriceClient;
  const mockRedisClient: any = {
    ts: {
      get: jest.fn(),
      range: jest.fn(),
      create: jest.fn(),
      add: jest.fn(),
      mAdd: jest.fn(),
    },
    zIncrBy: jest.fn(),
    zRange: jest.fn(),
    set: jest.fn(),
    multi: jest.fn(),
  };

  beforeEach(() => {
    priceClient = new PriceClient(testLogger, mockRedisClient);
    jest.clearAllMocks();

    // Mock all logger methods to prevent console output during tests
    jest.spyOn(testLogger, "error").mockImplementation(() => testLogger);
    jest.spyOn(testLogger, "info").mockImplementation(() => testLogger);
    jest.spyOn(testLogger, "warn").mockImplementation(() => testLogger);
    jest.spyOn(testLogger, "debug").mockImplementation(() => testLogger);
    jest.spyOn(testLogger, "trace").mockImplementation(() => testLogger);

    // Mock multi() pipeline
    const mockPipeline = {
      ts: {
        create: jest.fn().mockReturnThis(),
      },
      zIncrBy: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockRedisClient.multi.mockReturnValue(mockPipeline);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return current price data", async () => {
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

  it("should handle missing historical data", async () => {
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

  it("should handle missing token", async () => {
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

  it("handles errors", async () => {
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

  // New tests for initPriceCache
  describe("initPriceCache", () => {
    it("should initialize price cache successfully", async () => {
      // Mock fetchAllTokens to return predefined tokens
      const mockTokens = [
        "XLM",
        "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      ];

      jest
        .spyOn(priceClient as any, "fetchAllTokens")
        .mockResolvedValue(mockTokens);

      await priceClient.initPriceCache();

      // Verify redis operations
      expect(mockRedisClient.multi).toHaveBeenCalled();
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.any(String),
        "true",
      );
      expect(testLogger.info).toHaveBeenCalledWith(
        `Fetched ${mockTokens.length} total tokens`,
      );
    });

    it("should handle errors during initialization", async () => {
      jest
        .spyOn(priceClient as any, "fetchAllTokens")
        .mockRejectedValue(new Error("Failed to fetch tokens"));

      await expect(priceClient.initPriceCache()).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("initializing price cache"),
        }),
      );
    });
  });

  // Tests for updatePrices
  describe("updatePrices", () => {
    it("should update prices successfully", async () => {
      // Mock getTokensToUpdate
      const mockTokens = [
        "XLM",
        "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      ];

      jest
        .spyOn(priceClient as any, "getTokensToUpdate")
        .mockResolvedValue(mockTokens);

      // Mock processTokenBatches
      jest
        .spyOn(priceClient as any, "processTokenBatches")
        .mockResolvedValue(undefined);

      await priceClient.updatePrices();

      // Verify method calls
      expect(priceClient["getTokensToUpdate"]).toHaveBeenCalled();
      expect(priceClient["processTokenBatches"]).toHaveBeenCalledWith(
        mockTokens,
      );
    });

    it("should handle errors during price updates", async () => {
      jest
        .spyOn(priceClient as any, "getTokensToUpdate")
        .mockRejectedValue(new Error("Failed to get tokens"));

      await expect(priceClient.updatePrices()).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("updating prices"),
        }),
      );
    });
  });

  // Tests for private methods
  describe("Private methods", () => {
    it("getTokensToUpdate should fetch tokens from sorted set", async () => {
      const mockTokens = [
        "XLM",
        "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      ];

      mockRedisClient.zRange.mockResolvedValue(mockTokens);

      const result = await priceClient["getTokensToUpdate"]();

      expect(result).toEqual(mockTokens);
      expect(mockRedisClient.zRange).toHaveBeenCalledWith(
        expect.any(String),
        0,
        -1,
        { REV: true },
      );
    });

    it("getTokensToUpdate should throw error if no tokens found", async () => {
      mockRedisClient.zRange.mockResolvedValue([]);

      await expect(priceClient["getTokensToUpdate"]()).rejects.toThrow(
        "No tokens found in sorted set",
      );
    });

    it("processTokenBatches should process tokens in batches", async () => {
      const mockTokens = Array(1000)
        .fill(0)
        .map((_, i) => `TOKEN${i}`);

      // Mock addBatchToCache
      jest
        .spyOn(priceClient as any, "addBatchToCache")
        .mockResolvedValue(undefined);

      // Mock setTimeout
      jest.spyOn(global, "setTimeout").mockImplementation((cb: any) => {
        cb();
        return 0 as any;
      });

      await priceClient["processTokenBatches"](mockTokens);

      // With default batch size of 150, we expect 3 batches
      expect(priceClient["addBatchToCache"]).toHaveBeenCalledTimes(7);
      expect(testLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Processing batch 1 of 7"),
      );
    });

    it("addBatchToCache should calculate prices and add to Redis", async () => {
      const mockTokens = ["TOKEN1", "TOKEN2"];
      const mockPrices = [
        { token: "TOKEN1", timestamp: 123456789, price: new BigNumber(100) },
        { token: "TOKEN2", timestamp: 123456789, price: new BigNumber(200) },
      ];

      jest
        .spyOn(priceClient as any, "calculateBatchPrices")
        .mockResolvedValue(mockPrices);

      await priceClient["addBatchToCache"](mockTokens);

      expect(mockRedisClient.ts.mAdd).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            key: "TOKEN1",
            timestamp: 123456789,
            value: 100,
          }),
          expect.objectContaining({
            key: "TOKEN2",
            timestamp: 123456789,
            value: 200,
          }),
        ]),
      );
    });

    it("addBatchToCache should throw error if no prices calculated", async () => {
      jest
        .spyOn(priceClient as any, "calculateBatchPrices")
        .mockResolvedValue([]);

      await expect(priceClient["addBatchToCache"](["TOKEN1"])).rejects.toThrow(
        "No prices calculated",
      );
    });

    it("handleMissingToken should add new token to cache", async () => {
      const mockPrice = new BigNumber(1000);

      jest
        .spyOn(priceClient as any, "addNewTokenToCache")
        .mockResolvedValue(mockPrice);

      const result = await priceClient["handleMissingToken"]("NEW:TOKEN");

      expect(result).toEqual({
        currentPrice: mockPrice,
        percentagePriceChange24h: null,
      });
      expect(priceClient["addNewTokenToCache"]).toHaveBeenCalledWith(
        "NEW:TOKEN",
      );
    });

    it("handleMissingToken should handle errors", async () => {
      jest
        .spyOn(priceClient as any, "addNewTokenToCache")
        .mockRejectedValue(new Error("Failed to add token"));

      const result = await priceClient["handleMissingToken"]("NEW:TOKEN");

      expect(result).toBeNull();
      expect(testLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(
            "adding missing token to cache for NEW:TOKEN",
          ),
        }),
      );
    });

    it("getTimeSeriesKey should handle native asset correctly", async () => {
      expect(priceClient["getTimeSeriesKey"]("native")).toBe("XLM");
      expect(priceClient["getTimeSeriesKey"]("CODE:ISSUER")).toBe(
        "CODE:ISSUER",
      );
    });
  });
});
