import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE = "awca_admin";

export function passwordMatches(input, expected) {
  if (typeof expected !== "string" || expected.length === 0) return false;
  const a = createHmac("sha256", "awca-admin-check").update(String(input ?? "")).digest();
  const b = createHmac("sha256", "awca-admin-check").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function issueToken(password, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ role: "admin", exp: now + TOKEN_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", password).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token, password, now = Date.now()) {
  if (!token || !password) return false;
  const parts = String(token).split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  const expected = createHmac("sha256", password).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.role === "admin" && Number(payload.exp) > now;
  } catch {
    return false;
  }
}

export function readCookie(req, name = COOKIE) {
  const raw = req.headers?.cookie || "";
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return "";
}

export function adminCookie(token, { secure = false } = {}) {
  const bits = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=43200",
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearAdminCookie() {
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function isSecureRequest(req) {
  const proto = req.headers?.["x-forwarded-proto"] || "";
  return String(proto).split(",")[0].trim() === "https";
}

export function requireCron(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    const error = new Error("Automatic draw is not configured. Set CRON_SECRET on the server.");
    error.status = 503;
    throw error;
  }
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const token = String(header).startsWith("Bearer ") ? String(header).slice("Bearer ".length) : "";
  if (!passwordMatches(token, secret)) {
    const error = new Error("Cron authorization failed.");
    error.status = 401;
    throw error;
  }
}

export function requireAdmin(req) {
  const password = process.env.ADMIN_PASSWORD || "";
  if (!password) {
    const error = new Error("Admin access is not configured. Set ADMIN_PASSWORD on the server.");
    error.status = 503;
    throw error;
  }
  const token = readCookie(req);
  if (!verifyToken(token, password)) {
    const error = new Error("Admin sign-in is required.");
    error.status = 401;
    throw error;
  }
}
