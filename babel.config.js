// Used by Jest only (via babel-jest) to down-level the ESM-only @noble/*
// packages that @stellar/stellar-sdk@16 depends on. Production builds go
// through ts-jest/webpack and do not read this config.
module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
};
