import { BUSINESS_CACHE_CONTROL } from "./business-supporters.js";
import { getBusinessSupporters } from "../lib/business.js";
import { listOrdersForPlan, listPlans } from "../lib/wix.js";
import { renderSitemap, sendBody } from "../lib/business-pages.js";

export function createHandler(deps = { listPlans, listOrdersForPlan }) {
  return async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendBody(res, 405, "Method not allowed", {
        contentType: "text/plain; charset=utf-8",
        cacheControl: "no-store",
        robots: "noindex",
      });
      return;
    }
    try {
      const data = await getBusinessSupporters(deps);
      sendBody(res, 200, renderSitemap(data.supporters || []), {
        contentType: "application/xml; charset=utf-8",
        cacheControl: BUSINESS_CACHE_CONTROL,
        robots: "index, follow",
      });
    } catch (error) {
      console.error("AWCA sitemap unavailable:", error?.message || error);
      sendBody(res, 503, "Sitemap unavailable", {
        contentType: "text/plain; charset=utf-8",
        cacheControl: "no-store",
        robots: "noindex",
      });
    }
  };
}

export default createHandler();
