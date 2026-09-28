import { asyncHandler, sendJson } from "../lib/http.js";
import { getBusinessSupporters } from "../lib/business.js";
import { listOrdersForPlan, listPlans } from "../lib/wix.js";

// New subscribers show up within about 5 minutes.
export const BUSINESS_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

export function createHandler(deps = { listPlans, listOrdersForPlan }) {
  return asyncHandler(async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    let body;
    try {
      body = await getBusinessSupporters(deps);
    } catch (error) {
      console.error("AWCA business supporters unavailable:", error?.message || error);
      sendJson(res, 200, { available: false, supporters: [] }, { cacheControl: "no-store" });
      return;
    }
    sendJson(res, 200, body, { cacheControl: BUSINESS_CACHE_CONTROL });
  });
}

export default createHandler();
