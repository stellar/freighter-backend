import { PriceClient } from "./index";
import { testLogger } from "../../helper/test-helper";
import { TokenPriceData } from "./types";
import BigNumber from "bignumber.js";
import { PriceCalculationError } from "./errors";
describe("Token Price Client", () => {
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

  describe("getPrice", () => {
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

    it("should return null for stale prices", async () => {
      // Setup mock Redis responses with a stale timestamp (older than 5 minutes)
      const mockCurrentPrice = 50000;
      const staleTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago

      // Mock ts.get to return stale price data
      mockRedisClient.ts.get.mockResolvedValue({
        timestamp: staleTimestamp,
        value: mockCurrentPrice,
      });

      const token =
        "BTC:GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM";
      const result = await priceClient.getPrice(token);

      expect(result).toBeNull();
      // Verify Redis client was called
      expect(mockRedisClient.ts.get).toHaveBeenCalledWith(token);
      // Range and zIncrBy should not be called since we return early for stale prices
      expect(mockRedisClient.ts.range).not.toHaveBeenCalled();
      expect(mockRedisClient.zIncrBy).not.toHaveBeenCalled();
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

    it("should handle new token request", async () => {
      // Setup mock - ts.get throws error for non-existent key
      mockRedisClient.ts.get.mockRejectedValue(new Error("Key does not exist"));

      // Spy on addNewTokenToCache method
      const addNewTokenToCacheSpy = jest.spyOn(
        priceClient as any,
        "addNewTokenToCache",
      );
      addNewTokenToCacheSpy.mockResolvedValue({
        currentPrice: new BigNumber(60000),
        percentagePriceChange24h: null,
      } as TokenPriceData);

      const token = "NONEXISTENT:TOKEN";
      const result = await priceClient.getPrice(token);

      // Should call addNewTokenToCache and return its result
      expect(addNewTokenToCacheSpy).toHaveBeenCalledWith(token);
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
  });

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

      // With default batch size of 150 and 1000 tokens, we expect 7 batches
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

    it("getTimeSeriesKey should handle native asset correctly", async () => {
      expect(priceClient["getTimeSeriesKey"]("native")).toBe("XLM");
      expect(priceClient["getTimeSeriesKey"]("CODE:ISSUER")).toBe(
        "CODE:ISSUER",
      );
    });
  });

  describe("Price Calculation Methods", () => {
    it("should calculate prices for a batch of tokens", async () => {
      // Mock calculatePriceInUSD to return predefined values
      jest
        .spyOn(priceClient as any, "calculatePriceInUSD")
        .mockResolvedValueOnce({
          timestamp: 123456789,
          price: new BigNumber(100),
        })
        .mockResolvedValueOnce({
          timestamp: 123456789,
          price: new BigNumber(200),
        });

      const tokens = ["TOKEN1", "TOKEN2"];
      const result = await priceClient["calculateBatchPrices"](tokens);

      expect(result).toEqual([
        { token: "TOKEN1", timestamp: 123456789, price: new BigNumber(100) },
        { token: "TOKEN2", timestamp: 123456789, price: new BigNumber(200) },
      ]);
      expect(priceClient["calculatePriceInUSD"]).toHaveBeenCalledTimes(2);
    });

    it("should filter out failed price calculations", async () => {
      // Mock one successful and one failed calculation
      jest
        .spyOn(priceClient as any, "calculatePriceInUSD")
        .mockResolvedValueOnce({
          timestamp: 123456789,
          price: new BigNumber(100),
        })
        .mockRejectedValueOnce(new Error("Failed to calculate price"));

      const tokens = ["TOKEN1", "TOKEN2"];
      const result = await priceClient["calculateBatchPrices"](tokens);

      expect(result).toEqual([
        { token: "TOKEN1", timestamp: 123456789, price: new BigNumber(100) },
      ]);
      expect(testLogger.error).toHaveBeenCalled();
    });

    it("should calculate price in USD with timeout", async () => {
      // Mock calculatePriceUsingPaths to return a value
      jest
        .spyOn(priceClient as any, "calculatePriceUsingPaths")
        .mockResolvedValue({ timestamp: 123456789, price: new BigNumber(100) });

      const result = await priceClient["calculatePriceInUSD"]("TOKEN1");

      expect(result).toEqual({
        timestamp: 123456789,
        price: new BigNumber(100),
      });
      expect(priceClient["calculatePriceUsingPaths"]).toHaveBeenCalledWith(
        "TOKEN1",
      );
    });

    it("should handle timeout in price calculation", async () => {
      // Use Jest's timer mocks
      jest.useFakeTimers();

      // Mock calculatePriceUsingPaths to never resolve (simulating a hanging operation)
      jest
        .spyOn(priceClient as any, "calculatePriceUsingPaths")
        .mockImplementation(
          () =>
            new Promise(() => {
              // This promise will never resolve during the test
            }),
        );

      // Start the price calculation but don't await it yet
      const pricePromise = priceClient["calculatePriceInUSD"]("TOKEN1");

      // Fast-forward time past the timeout
      jest.advanceTimersByTime(10000 + 100);

      // Now await the promise, which should reject due to timeout
      await expect(pricePromise).rejects.toThrow(
        new PriceCalculationError("TOKEN1"),
      );

      // Restore real timers
      jest.useRealTimers();
    });

    it("should create time series for a new token", async () => {
      await priceClient["createTimeSeries"]("TOKEN1");

      expect(mockRedisClient.ts.create).toHaveBeenCalledWith(
        "TOKEN1",
        expect.objectContaining({
          RETENTION: expect.any(Number),
          DUPLICATE_POLICY: expect.any(String),
          LABELS: expect.any(Object),
        }),
      );
      expect(mockRedisClient.zIncrBy).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "TOKEN1",
      );
    });
  });

  describe("fetchAllTokens", () => {
    beforeEach(() => {
      // Mock fetch
      global.fetch = jest.fn();
    });

    it("should fetch tokens from StellarExpert API", async () => {
      // Mock first page of results
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          _embedded: {
            records: [
              { asset: "XLM" }, // Should be skipped as it's already included
              { asset: "USDC" }, // Should be skipped
              {
                tomlInfo: { code: "TOKEN1", issuer: "ISSUER1" },
              },
              {
                asset: "TOKEN2-ISSUER2",
              },
            ],
          },
          _links: { next: { href: "/next-page" } },
        }),
      });

      // Mock second page with no more pages
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          _embedded: {
            records: [
              {
                tomlInfo: { code: "TOKEN3", issuer: "ISSUER3" },
              },
            ],
          },
          _links: {},
        }),
      });

      const result = await priceClient["fetchAllTokens"]();

      expect(result).toContain("XLM");
      expect(result).toContain("TOKEN1:ISSUER1");
      expect(result).toContain("TOKEN2:ISSUER2");
      expect(result).toContain("TOKEN3:ISSUER3");
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should handle errors when fetching tokens", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("API error"));

      const result = await priceClient["fetchAllTokens"]();

      // Should still return XLM as default
      expect(result).toEqual(["XLM"]);
      expect(testLogger.error).toHaveBeenCalled();
    });
  });
});
