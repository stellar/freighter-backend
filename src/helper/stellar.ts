import * as StellarSdkNext from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";

export const isNextSdk = (networkPassphrase: StellarSdkNext.Networks) =>
  [StellarSdk.Networks.FUTURENET, StellarSdk.Networks.TESTNET].includes(
    networkPassphrase
  );

export const getSdk = (networkPassphrase: StellarSdkNext.Networks) =>
  isNextSdk(networkPassphrase) ? StellarSdkNext : StellarSdk;
