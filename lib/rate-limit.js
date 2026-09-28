import { createHash } from "node:crypto";
import { kvStore } from "./kv.js";

export const MAX_ATTEMPTS = 5;
export const WINDOW_SECONDS = 15 * 60;
export const LOCK_MESSAGE = "Too many attempts. Please try again in 15 minutes.";

const WINDOW_MS = WINDOW_SECONDS * 1000;

export function clientIp(req) {
  const forwarded = headerValue(req, "x-forwarded-for");
  const real = headerValue(req, "x-real-ip");
  const candidate = firstHop(forwarded) || firstHop(real);
  if (candidate) return candidate;
  const socketIp = req?.socket?.remoteAddress || req?.connection?.remoteAddress || "";
  return socketIp || "unknown";
}

function headerValue(req, name) {
  const headers = req?.headers || {};
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.join(",");
  return raw == null ? "" : String(raw);
}

function firstHop(value) {
  const hop = String(value || "").split(",")[0].trim();
  return hop;
}

export function adminFailureKey(ip) {
  const hash = createHash("sha256").update(String(ip)).digest("hex");
  return `awca:admin-fail:${hash}`;
}

export function lockError(retryAfter) {
  const error = new Error(LOCK_MESSAGE);
  error.status = 429;
  error.headers = { "Retry-After": String(retryAfter) };
  return error;
}

let notedStoreFailure = false;

function noteStoreFailure(error) {
  if (!error || error.code === "KV_UNAVAILABLE") return;
  if (notedStoreFailure) return;
  notedStoreFailure = true;
  console.warn("AWCA admin rate limit unavailable");
}

function parseRecord(raw) {
  if (raw == null || raw === "") return null;
  try {
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    const count = Number(record?.count);
    const resetAt = Number(record?.resetAt);
    if (!Number.isFinite(count) || !Number.isFinite(resetAt)) return null;
    return { count, resetAt };
  } catch {
    return null;
  }
}

function retryAfterFor(resetAt, now) {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

export function rateStore(req) {
  return req?.rateLimitStore || kvStore();
}

export async function assertAdminAllowed(req, store = rateStore(req), now = Date.now()) {
  let record = null;
  try {
    record = parseRecord(await store.get(adminFailureKey(clientIp(req))));
  } catch (error) {
    noteStoreFailure(error);
    return;
  }
  if (!record || record.resetAt <= now || record.count < MAX_ATTEMPTS) return;
  throw lockError(retryAfterFor(record.resetAt, now));
}

export async function recordAdminFailure(ip, store, now = Date.now()) {
  const key = adminFailureKey(ip);
  try {
    const current = parseRecord(await store.get(key));
    const fresh = !current || current.resetAt <= now;
    const count = fresh ? 1 : current.count + 1;
    const resetAt = fresh ? now + WINDOW_MS : current.resetAt;
    const retryAfter = retryAfterFor(resetAt, now);
    await store.set(key, JSON.stringify({ count, resetAt }), retryAfter);
    return {
      locked: count >= MAX_ATTEMPTS,
      retryAfter: count >= MAX_ATTEMPTS ? retryAfter : 0,
      count,
    };
  } catch (error) {
    noteStoreFailure(error);
    return { locked: false, retryAfter: 0, count: 0, failedOpen: true };
  }
}

export async function clearAdminFailures(ip, store) {
  try {
    await store.del(adminFailureKey(ip));
  } catch (error) {
    noteStoreFailure(error);
  }
}

export function createMemoryStore() {
  const rows = new Map();
  return {
    async get(key) {
      const row = rows.get(key);
      if (!row) return null;
      if (row.expiresAt <= Date.now()) {
        rows.delete(key);
        return null;
      }
      return row.value;
    },
    async set(key, value, ttlSeconds) {
      const ttl = Math.max(1, Number(ttlSeconds) || 1);
      rows.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    },
    async del(key) {
      rows.delete(key);
    },
    async incr(key, ttlSeconds) {
      const current = Number(await this.get(key)) || 0;
      const next = current + 1;
      await this.set(key, String(next), ttlSeconds);
      return next;
    },
    keys() {
      return [...rows.keys()];
    },
  };
}
