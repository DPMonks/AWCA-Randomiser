// Vercel KV and Upstash Redis share one REST shape.
// Missing config throws KV_UNAVAILABLE. A failed request throws KV_ERROR.
// Callers fail open: sign-in still checks the password.

const URL_KEYS = ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"];
const TOKEN_KEYS = ["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"];

function firstFrom(env, names) {
  for (const name of names) {
    const value = String(env?.[name] || "").trim();
    if (value) return value;
  }
  return "";
}

export function kvConfig(env = process.env) {
  const url = firstFrom(env, URL_KEYS);
  const token = firstFrom(env, TOKEN_KEYS);
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

function unavailable(code) {
  const error = new Error("KV is unavailable");
  error.code = code;
  return error;
}

async function command(config, args) {
  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  } catch {
    throw unavailable("KV_ERROR");
  }
  if (!response.ok) throw unavailable("KV_ERROR");
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw unavailable("KV_ERROR");
  }
  if (payload && payload.error) throw unavailable("KV_ERROR");
  return payload?.result ?? null;
}

export function kvStore(env = process.env) {
  return {
    async get(key) {
      const config = kvConfig(env);
      if (!config) throw unavailable("KV_UNAVAILABLE");
      return command(config, ["GET", key]);
    },
    async set(key, value, ttlSeconds) {
      const config = kvConfig(env);
      if (!config) throw unavailable("KV_UNAVAILABLE");
      const ttl = Math.max(1, Number(ttlSeconds) || 1);
      await command(config, ["SET", key, value, "EX", String(ttl)]);
    },
    async del(key) {
      const config = kvConfig(env);
      if (!config) throw unavailable("KV_UNAVAILABLE");
      await command(config, ["DEL", key]);
    },
  };
}
