import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";

const requestMethod = "POST";
const requestHost = "api.developer.coinbase.com";
const requestPath = "/onramp/v1/token";

const uri = `${requestMethod} ${requestHost}${requestPath}`;

export interface CoinbaseConfig {
  coinbaseApiKey: string;
  coinbaseApiSecret: string;
}

export const generateJWT = ({
  coinbaseConfig,
}: {
  coinbaseConfig: CoinbaseConfig;
}): string => {
  const algorithm = "ES256";
  const payload = {
    iss: "cdp",
    nbf: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 120,
    sub: coinbaseConfig.coinbaseApiKey,
    uri,
  };

  const header = {
    alg: algorithm,
    kid: coinbaseConfig.coinbaseApiKey,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  return jwt.sign(payload, coinbaseConfig.coinbaseApiSecret, {
    algorithm,
    header,
  });
};

export const fetchOnrampSessionToken = async ({
  address,
  coinbaseConfig,
}: {
  address: string;
  coinbaseConfig: {
    coinbaseApiKey: string;
    coinbaseApiSecret: string;
  };
}) => {
  try {
    const options = {
      method: requestMethod,
      headers: {
        Authorization: `Bearer ${generateJWT({ coinbaseConfig })}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addresses: [{ address, blockchains: ["stellar"], assets: ["XLM"] }],
      }),
    };
    const res = await fetch(`https://${requestHost}${requestPath}`, options);

    const resJson = await res.json();

    const { token } = resJson;

    return { data: { token }, error: null };
  } catch (e) {
    return {
      data: { token: null },
      error: e,
    };
  }
};
