import jwt from "jsonwebtoken";
import * as crypto from "crypto";
import proxyaddr from "proxy-addr";

const requestMethod = "POST";
const requestHost = "api.developer.coinbase.com";
const requestPath = "/onramp/v1/token";

const uri = `${requestMethod} ${requestHost}${requestPath}`;

export interface CoinbaseConfig {
  coinbaseApiKey: string;
  coinbaseApiSecret: string;
}

// Loopback, link-local, and unique-local (RFC1918 + IPv6 ULA) addresses.
// Used to avoid forwarding intra-cluster IPs to Coinbase when the trustProxy
// chain is misconfigured — Coinbase rejects private addresses, so dropping
// clientIp keeps the endpoint functional while we surface the misconfiguration
// via a warning log at the call site.
const internalAddr = proxyaddr.compile([
  "loopback",
  "linklocal",
  "uniquelocal",
]);

export const isLikelyInternalIp = (ip: string): boolean => {
  if (!ip) return true;
  return internalAddr(ip, 0);
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
        detail = await res.text();
      } catch {
        // body unreadable
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
