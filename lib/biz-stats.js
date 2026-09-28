import { isSlug } from "./business-pages.js";
import { londonMonthKey } from "./format.js";

const MAX_SLUGS = 80;
const TTL_SECONDS = 400 * 24 * 60 * 60;

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegrambot|slackbot|wget|curl|python-requests|headlesschrome|lighthouse|pagespeed|petalbot|semrush|ahrefs|mj12bot|dotbot|bytespider|gptbot|claudebot|amazonbot|applebot/i;

function headerValue(req, name) {
  const headers = req?.headers || {};
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.join(",");
  return raw == null ? "" : String(raw);
}

export function isStatsBot(req) {
  return BOT.test(headerValue(req, "user-agent"));
}

export function cleanStatSlugs(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const slug = String(item || "").trim();
    if (!isSlug(slug) || slug.length > 80 || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= MAX_SLUGS) break;
  }
  return out;
}

export function statKey(month, type, slug) {
  const field = type === "click" ? "clicks" : "views";
  return `awca:biz-stat:${month}:${field}:${slug}`;
}

export async function recordBusinessStats(store, { type, slugs, now = new Date() } = {}) {
  const month = londonMonthKey(now instanceof Date ? now : new Date(now));
  const kind = type === "click" ? "click" : "view";
  for (const slug of cleanStatSlugs(slugs)) {
    await store.incr(statKey(month, kind, slug), TTL_SECONDS);
  }
  return month;
}

export async function readBusinessStats(store, slugs, now = new Date()) {
  const month = londonMonthKey(now instanceof Date ? now : new Date(now));
  const stats = {};
  for (const slug of cleanStatSlugs(slugs)) {
    const views = Number(await store.get(statKey(month, "view", slug))) || 0;
    const clicks = Number(await store.get(statKey(month, "click", slug))) || 0;
    stats[slug] = { views, clicks };
  }
  return { month, stats };
}
