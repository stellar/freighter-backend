import jwt from "jsonwebtoken";
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

  // When we set values in Vault, we aren't able to set this value with "" around it.
  // Because of that, when JS interperets it, it tries to escape `/n` characters, turning them into `//n`
  // Adding this extra slash breaks the algorithm, so we need to remove it.
  const coinbaseApiSecret = coinbaseConfig.coinbaseApiSecret.replaceAll(
    "\\n",
    "\n",
  );

  return jwt.sign(payload, coinbaseApiSecret, {
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

    if (!res.ok) {
      if (res.status >= 500 && res.status < 600) {
        throw new Error("Server error when requesting token");
      }
      return { data: { token: "", error: "Error fetching token request" } };
    }

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
