import {
  canonicalizeJson,
  sha256Hex,
  encodeSep53Message,
  SIGN_MESSAGE_PREFIX,
} from "./onramp-auth";
import { hash } from "stellar-sdk";

describe("onramp-auth primitives", () => {
  it("canonicalizes objects with sorted keys and no whitespace", () => {
    expect(canonicalizeJson({ b: 1, a: "x" })).toEqual('{"a":"x","b":1}');
    expect(canonicalizeJson({})).toEqual("{}");
    expect(canonicalizeJson({ z: { y: 2, x: 1 } })).toEqual(
      '{"z":{"x":1,"y":2}}',
    );
  });

  it("sha256Hex matches a known vector", () => {
    // echo -n '{}' | shasum -a 256
    expect(sha256Hex("{}")).toEqual(
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });

  it("encodeSep53Message hashes the prefixed message", () => {
    const msg = '{"a":1}';
    const expected = hash(
      Buffer.concat([
        Buffer.from(SIGN_MESSAGE_PREFIX, "utf8"),
        Buffer.from(msg, "utf8"),
      ]),
    );
    expect(encodeSep53Message(msg).equals(expected)).toBe(true);
  });
});
