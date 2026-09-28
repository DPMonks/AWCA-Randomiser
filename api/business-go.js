import { getBusinessSupporters } from "../lib/business.js";
import { isStatsBot, recordBusinessStats } from "../lib/biz-stats.js";
import { isSlug, readSlug, SITE_ORIGIN } from "../lib/business-pages.js";
import { kvStore } from "../lib/kv.js";
import { listOrdersForPlan, listPlans } from "../lib/wix.js";

function sendRedirect(res, status, location) {
  res.status(status);
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.send("");
}

export function createHandler(deps = { listPlans, listOrdersForPlan }) {
  return async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405);
      res.setHeader("Cache-Control", "no-store");
      res.send("Method not allowed");
      return;
    }
    const slug = readSlug(req);
    if (!isSlug(slug)) {
      sendRedirect(res, 302, `${SITE_ORIGIN}/businesses`);
      return;
    }
    let website = "";
    let known = false;
    try {
      const data = await getBusinessSupporters(deps);
      const match = (data.supporters || []).find((item) => item.slug === slug);
      if (match) {
        known = true;
        website = match.website || "";
      }
    } catch (error) {
      console.error("AWCA business redirect lookup failed:", error?.message || error);
    }
    if (known && !isStatsBot(req)) {
      const store = deps.statsStore || req.statsStore || kvStore();
      try {
        await recordBusinessStats(store, { type: "click", slugs: [slug] });
      } catch (error) {
        console.error("AWCA business click not recorded:", error?.message || error);
      }
    }
    const fallback = known ? `${SITE_ORIGIN}/businesses/${slug}` : `${SITE_ORIGIN}/businesses`;
    sendRedirect(res, 302, website || fallback);
  };
}

export default createHandler();
