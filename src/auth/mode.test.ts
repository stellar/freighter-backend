import { parseMode } from "./mode";

describe("parseMode", () => {
  it('treats "" as permissive', () => {
    expect(parseMode("")).toBe("permissive");
  });
  it("treats undefined as permissive", () => {
    expect(parseMode(undefined)).toBe("permissive");
  });
  it('parses "permissive"', () => {
    expect(parseMode("permissive")).toBe("permissive");
  });
  it('parses "strict"', () => {
    expect(parseMode("strict")).toBe("strict");
  });
  it('throws on "Dual"', () => {
    expect(() => parseMode("Dual")).toThrow();
  });
  it('throws on "bogus"', () => {
    expect(() => parseMode("bogus")).toThrow();
  });
});
