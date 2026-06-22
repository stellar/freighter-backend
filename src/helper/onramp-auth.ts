import { createHash } from "crypto";
import { hash } from "stellar-sdk";

export const SIGN_MESSAGE_PREFIX = "Stellar Signed Message:\n";

export const canonicalizeJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${entries.join(",")}}`;
};

export const sha256Hex = (data: string): string =>
  createHash("sha256").update(data, "utf8").digest("hex");

export const encodeSep53Message = (message: string): Buffer =>
  hash(
    Buffer.concat([
      Buffer.from(SIGN_MESSAGE_PREFIX, "utf8"),
      Buffer.from(message, "utf8"),
    ]),
  );
