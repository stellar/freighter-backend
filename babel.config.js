// Used by Jest only (via babel-jest) to down-level the ESM-only packages that
// @stellar/stellar-sdk@17 depends on (@noble/*, @exodus/bytes; see the
// transformIgnorePatterns allowlist in jest.config.js). Production builds go
// through ts-jest/webpack and do not read this config.
module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
};
