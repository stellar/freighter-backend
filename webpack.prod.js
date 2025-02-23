const path = require("path");
const nodeExternals = require("webpack-node-externals");
module.exports = [
  {
    entry: "./src/index.ts",
    mode: "production",
    target: "node",
    devtool: "inline-source-map",
    output: {
      path: path.resolve(__dirname, "build"),
      filename: "index.js",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    externals: [nodeExternals()],
    module: {
      rules: [
        {
          test: /\.([cm]?ts)$/,
          use: ["ts-loader"],
        },
      ],
    },
  },
  {
    entry: "./src/service/integrity-checker/worker.ts",
    mode: "production",
    target: "node",
    devtool: "inline-source-map",
    output: {
      path: path.resolve(__dirname, "build"),
      filename: "worker.js",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    externals: [nodeExternals()],
    module: {
      rules: [
        {
          test: /\.([cm]?ts)$/,
          use: ["ts-loader"],
        },
      ],
    },
  },
  {
    entry: "./src/service/prices/worker.ts",
    mode: "production",
    target: "node",
    devtool: "inline-source-map",
    output: {
      path: path.resolve(__dirname, "build"),
      filename: "price-worker.js",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    externals: [nodeExternals()],
    module: {
      rules: [
        {
          test: /\.([cm]?ts)$/,
          use: ["ts-loader"],
        },
      ],
    },
  },
];
