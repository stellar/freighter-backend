/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // The @stellar/stellar-sdk CJS build require()s @noble/hashes, @noble/ed25519
  // (since 16) and @exodus/bytes (since 17), which are "type": "module" with no
  // CJS entry point. Node >= 22.12 resolves that natively via require(esm), but
  // Jest's CJS sandbox does not, so those packages have to be transformed on
  // the way in rather than passed through untouched.
  transformIgnorePatterns: [
    "/node_modules/(?!(@noble/|@exodus/|uint8array-extras/|eventsource/))",
  ],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
    "^.+\\.jsx?$": "babel-jest",
  },
};
