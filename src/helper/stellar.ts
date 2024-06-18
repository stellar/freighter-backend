import * as StellarSdkNext from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";

export const isNextSdk = (networkPassphrase: StellarSdkNext.Networks) =>
  [""].includes(networkPassphrase);

export const getSdk = (networkPassphrase: StellarSdkNext.Networks) =>
  isNextSdk(networkPassphrase) ? StellarSdkNext : StellarSdk;
