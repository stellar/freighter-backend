/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // As of @stellar/stellar-sdk@16, the SDK's CJS build require()s
  // @noble/hashes and @noble/ed25519, which are "type": "module" with no CJS
  // entry point. Node >= 25 resolves that natively via require(esm), but Jest's
  // CJS sandbox does not, so those packages have to be transformed on the way
  // in rather than passed through untouched.
  transformIgnorePatterns: [
    "/node_modules/(?!(@noble/|uint8array-extras/|eventsource/))",
  ],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
    "^.+\\.jsx?$": "babel-jest",
  },
};
