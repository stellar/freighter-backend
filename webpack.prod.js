const path = require("path");
const nodeExternals = require("webpack-node-externals");
module.exports = [
  {
    entry: "./src/index.ts",
    mode: "production",
    target: "node",
    devtool: "source-map",
    output: {
      path: path.resolve(__dirname, "build"),
      filename: "index.js",
      devtoolModuleFilenameTemplate: "[absolute-resource-path]",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    externals: [nodeExternals()],
    module: {
      rules: [
        {
          test: /\.([cm]?ts)$/,
          use: [
            {
              loader: "ts-loader",
              options: {
                compilerOptions: {
                  sourceMap: true,
                },
              },
            },
          ],
        },
      ],
    },
  },
  {
    entry: "./src/service/integrity-checker/worker.ts",
    mode: "production",
    target: "node",
    devtool: "source-map",
    output: {
      path: path.resolve(__dirname, "build"),
      filename: "worker.js",
      devtoolModuleFilenameTemplate: "[absolute-resource-path]",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    externals: [nodeExternals()],
    module: {
      rules: [
        {
          test: /\.([cm]?ts)$/,
          use: [
            {
              loader: "ts-loader",
              options: {
                compilerOptions: {
                  sourceMap: true,
                },
              },
            },
          ],
        },
      ],
    },
  },
  {
    entry: "./src/service/prices/worker.ts",
    mode: "production",
    target: "node",
    devtool: "source-map",
    output: {
      path: path.resolve(__dirname, "build"),
      filename: "price-worker.js",
      devtoolModuleFilenameTemplate: "[absolute-resource-path]",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    externals: [nodeExternals()],
    module: {
      rules: [
        {
          test: /\.([cm]?ts)$/,
          use: [
            {
              loader: "ts-loader",
              options: {
                compilerOptions: {
                  sourceMap: true,
                },
              },
            },
          ],
        },
      ],
    },
  },
];
