import { cleanStatSlugs, isStatsBot, recordBusinessStats } from "../lib/biz-stats.js";
import { kvStore } from "../lib/kv.js";

function readBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function sendEmpty(res, status) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send("");
}

export function createHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") {
      sendEmpty(res, 405);
      return;
    }
    const body = readBody(req);
    const type = body?.type === "click" ? "click" : body?.type === "view" ? "view" : "";
    const slugs = cleanStatSlugs(body?.slugs);
    if (!type || slugs.length === 0 || isStatsBot(req)) {
      sendEmpty(res, 204);
      return;
    }
    const store = deps.statsStore || req.statsStore || kvStore();
    try {
      await recordBusinessStats(store, { type, slugs });
    } catch (error) {
      console.error("AWCA business stats not recorded:", error?.message || error);
    }
    sendEmpty(res, 204);
  };
}

export default createHandler();
