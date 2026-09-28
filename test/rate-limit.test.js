import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSessionHandler } from "../api/session.js";
import membersApi from "../api/members.js";
import communityApi from "../api/community-members.js";
import drawApi from "../api/draw.js";
import drawsApi from "../api/draws.js";
import subscriptionsApi from "../api/business-subscriptions.js";
import { kvStore } from "../lib/kv.js";
import {
  LOCK_MESSAGE,
  MAX_ATTEMPTS,
  WINDOW_SECONDS,
  adminFailureKey,
  clearAdminFailures,
  clientIp,
  createMemoryStore,
  recordAdminFailure,
} from "../lib/rate-limit.js";

const IP = "203.0.113.10";
const FIXED_NOW = 1_700_000_000_000;

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    send(payload) {
      this.body = JSON.parse(payload);
    },
  };
}

function loginRequest(password, ip = IP, extraHeaders = {}) {
  return {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...extraHeaders },
    body: { password },
  };
}

async function postPassword(handler, password, ip = IP, extraHeaders = {}) {
  const res = fakeRes();
  await handler(loginRequest(password, ip, extraHeaders), res);
  return res;
}

function savedEnv(names) {
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test("five failed admin passwords lock the address", async () => {
  const restore = savedEnv(["ADMIN_PASSWORD"]);
  process.env.ADMIN_PASSWORD = "committee-secret";
  const store = createMemoryStore();
  const handler = createSessionHandler({ store, now: () => FIXED_NOW });
  try {
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      const res = await postPassword(handler, "wrong");
      assert.equal(res.statusCode, 401, `attempt ${attempt}`);
      assert.equal(res.headers["retry-after"], undefined);
      assert.equal(res.body.error, "That password is not correct.");
    }
    const locked = await postPassword(handler, "wrong");
    assert.equal(locked.statusCode, 429);
    assert.equal(locked.headers["retry-after"], String(WINDOW_SECONDS));
    assert.equal(locked.body.error, LOCK_MESSAGE);

    const still = await postPassword(handler, "committee-secret");
    assert.equal(still.statusCode, 429);
    assert.equal(still.headers["retry-after"], String(WINDOW_SECONDS));
    assert.equal(still.body.error, LOCK_MESSAGE);
  } finally {
    restore();
  }
});

test("a successful admin login clears the failure counter", async () => {
  const restore = savedEnv(["ADMIN_PASSWORD"]);
  process.env.ADMIN_PASSWORD = "committee-secret";
  const store = createMemoryStore();
  const handler = createSessionHandler({ store, now: () => FIXED_NOW });
  try {
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      const res = await postPassword(handler, "wrong");
      assert.equal(res.statusCode, 401);
    }
    const ok = await postPassword(handler, "committee-secret");
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.ok, true);
    assert.match(ok.headers["set-cookie"], /awca_admin=/);

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      const res = await postPassword(handler, "wrong");
      assert.equal(res.statusCode, 401, `after reset ${attempt}`);
    }
    const locked = await postPassword(handler, "wrong");
    assert.equal(locked.statusCode, 429);
    assert.equal(locked.headers["retry-after"], String(WINDOW_SECONDS));
  } finally {
    restore();
  }
});

test("rate limit keys store a hash of the ip and keep addresses apart", async () => {
  const store = createMemoryStore();
  const now = FIXED_NOW;
  await recordAdminFailure(IP, store, now);
  const keys = store.keys();
  assert.deepEqual(keys, [adminFailureKey(IP)]);
  assert.equal(keys[0].includes(IP), false);
  assert.equal(
    keys[0],
    `awca:admin-fail:${createHash("sha256").update(IP).digest("hex")}`
  );

  const other = "198.51.100.4";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await recordAdminFailure(other, store, now);
  }
  const first = await recordAdminFailure(IP, store, now);
  assert.equal(first.locked, false);
  assert.equal(first.count, 2);

  const forwarded = clientIp({ headers: { "x-forwarded-for": " 192.0.2.8, 10.0.0.1 " } });
  assert.equal(forwarded, "192.0.2.8");
  const real = clientIp({ headers: { "x-real-ip": "192.0.2.15" } });
  assert.equal(real, "192.0.2.15");
  const prefersForwarded = clientIp({
    headers: { "x-forwarded-for": "192.0.2.8", "x-real-ip": "192.0.2.15" },
  });
  assert.equal(prefersForwarded, "192.0.2.8");
});

test("protected admin routes return 429 with Retry-After while the address is locked", async () => {
  const restore = savedEnv(["ADMIN_PASSWORD"]);
  process.env.ADMIN_PASSWORD = "committee-secret";
  const store = createMemoryStore();
  const now = Date.now();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await recordAdminFailure(IP, store, now);
  }
  const routes = [
    [membersApi, "GET"],
    [communityApi, "GET"],
    [drawsApi, "GET"],
    [drawApi, "POST"],
    [subscriptionsApi, "GET"],
  ];
  try {
    for (const [handler, method] of routes) {
      const res = fakeRes();
      await handler({ method, headers: { "x-forwarded-for": IP }, rateLimitStore: store }, res);
      assert.equal(res.statusCode, 429, method);
      assert.equal(res.body.error, LOCK_MESSAGE);
      const retryAfter = Number(res.headers["retry-after"]);
      assert.equal(Number.isInteger(retryAfter), true);
      assert.equal(retryAfter >= 1 && retryAfter <= WINDOW_SECONDS, true);
    }
    await clearAdminFailures(IP, store);
    const open = fakeRes();
    await membersApi({ method: "GET", headers: { "x-forwarded-for": IP }, rateLimitStore: store }, open);
    assert.equal(open.statusCode, 401);
  } finally {
    restore();
  }
});

test("a missing or broken KV store fails open and still checks the password", async () => {
  const restore = savedEnv([
    "ADMIN_PASSWORD",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]);
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.ADMIN_PASSWORD = "committee-secret";
  const handler = createSessionHandler({ now: () => FIXED_NOW });
  const broken = {
    async get() {
      throw new Error("redis down");
    },
    async set() {
      throw new Error("redis down");
    },
    async del() {
      throw new Error("redis down");
    },
  };
  const brokenHandler = createSessionHandler({ store: broken, now: () => FIXED_NOW });
  try {
    const missingWrong = await postPassword(handler, "wrong");
    assert.equal(missingWrong.statusCode, 401);
    const missingRight = await postPassword(handler, "committee-secret");
    assert.equal(missingRight.statusCode, 200);

    for (let attempt = 0; attempt < MAX_ATTEMPTS + 2; attempt += 1) {
      const res = await postPassword(brokenHandler, "wrong");
      assert.equal(res.statusCode, 401);
    }
    const stillRight = await postPassword(brokenHandler, "committee-secret");
    assert.equal(stillRight.statusCode, 200);

    await assert.rejects(kvStore().get("awca:admin-fail:test"), (error) => error.code === "KV_UNAVAILABLE");
  } finally {
    restore();
  }
});

test("security headers cover every route and script hashes match the pages", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const expected = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  };
  for (const rule of config.headers) {
    const byName = Object.fromEntries(rule.headers.map((header) => [header.key, header.value]));
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(byName[key], value, `${rule.source} ${key}`);
    }
  }

  function hashes(html) {
    const found = [];
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html))) {
      if (!match[1]) continue;
      found.push(createHash("sha256").update(match[1], "utf8").digest("base64"));
    }
    return found;
  }

  const home = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const winners = await readFile(new URL("../public/winners-embed/index.html", import.meta.url), "utf8");
  const business = await readFile(new URL("../public/business-embed/index.html", import.meta.url), "utf8");
  const deny = config.headers.find((rule) => rule.source.includes("(?!winners-embed)"));
  const denyCsp = deny.headers.find((header) => header.key === "Content-Security-Policy").value;
  for (const hash of hashes(home)) assert.match(denyCsp, new RegExp(hash.replace(/[+/]/g, "\\$&")));
  assert.match(denyCsp, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(denyCsp, /default-src 'self'/);
  assert.match(denyCsp, /style-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(denyCsp, /unsafe-eval/);
  assert.doesNotMatch(denyCsp, /script-src[^;]*unsafe-inline/);

  const winnersCsp = config.headers.find((rule) => rule.source === "/winners-embed").headers
    .find((header) => header.key === "Content-Security-Policy").value;
  for (const hash of hashes(winners)) assert.match(winnersCsp, new RegExp(hash.replace(/[+/]/g, "\\$&")));

  const businessCsp = config.headers.find((rule) => rule.source === "/business-embed").headers
    .find((header) => header.key === "Content-Security-Policy").value;
  for (const hash of hashes(business)) assert.match(businessCsp, new RegExp(hash.replace(/[+/]/g, "\\$&")));
  assert.match(businessCsp, /https:\/\/static\.wixstatic\.com/);
  assert.match(businessCsp, /https:\/\/\*\.usrfiles\.com/);
  assert.match(businessCsp, /https:\/\/\*\.wixmp\.com/);

  const main = await readFile(new URL("../public/main.js", import.meta.url), "utf8");
  assert.match(main, /Too many attempts\. Please try again in 15 minutes\./);
  assert.match(main, /status === 429/);
});
