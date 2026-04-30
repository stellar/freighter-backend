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

// RFC1918 private, loopback, and link-local addresses (IPv4 and IPv4-mapped
// IPv6). Used to avoid forwarding intra-cluster IPs to Coinbase when the
// trustProxy chain is misconfigured — Coinbase rejects private addresses,
// so dropping clientIp keeps the endpoint functional while we surface the
// misconfiguration via a warning log at the call site.
export const isLikelyInternalIp = (ip: string): boolean => {
  if (!ip) return true;
  if (ip === "::1" || ip.startsWith("127.")) return true;
  return /(?:^|:)(10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(
    ip,
  );
};

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
  clientIp,
  coinbaseConfig,
}: {
  address: string;
  clientIp?: string;
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
        ...(clientIp ? { clientIp } : {}),
      }),
    };
    const res = await fetch(`https://${requestHost}${requestPath}`, options);

    if (!res.ok) {
      if (res.status >= 500 && res.status < 600) {
        throw new Error("Server error when requesting token");
      }
      let detail = "";
      try {
        detail = JSON.stringify(await res.json());
      } catch {
        try {
          detail = await res.text();
        } catch {
          // swallow
        }
      }
      return {
        data: { token: "" },
        error: `Coinbase ${res.status}${detail ? `: ${detail}` : ""}`,
      };
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
