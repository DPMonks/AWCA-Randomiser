import { isSecureRequest, readCookie } from "./auth.js";
import { isMockMode } from "./mock.js";

const COOKIE = "awca_mock_draws";

export function readExtraDraws(req) {
  if (!isMockMode()) return [];
  const raw = readCookie(req, COOKIE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function extraDrawsCookie(draws, { secure = false } = {}) {
  const value = encodeURIComponent(JSON.stringify(draws.slice(0, 20)));
  const bits = [
    `${COOKIE}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=2592000",
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function rememberDraw(req, res, draw) {
  if (!isMockMode() || !draw) return;
  const existing = readExtraDraws(req);
  res.setHeader(
    "Set-Cookie",
    extraDrawsCookie([draw, ...existing], { secure: isSecureRequest(req) })
  );
}
