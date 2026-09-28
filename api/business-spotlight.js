import { BUSINESS_CACHE_CONTROL } from "./business-supporters.js";
import { getBusinessSupporters } from "../lib/business.js";
import { asyncHandler, sendJson } from "../lib/http.js";
import { spotlightSlots } from "../lib/spotlight.js";
import { listOrdersForPlan, listPlans } from "../lib/wix.js";

export function createHandler(deps = { listPlans, listOrdersForPlan }) {
  return asyncHandler(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const data = await getBusinessSupporters(deps);
      const body = spotlightSlots(data.supporters || []);
      sendJson(res, 200, body, { cacheControl: BUSINESS_CACHE_CONTROL });
    } catch (error) {
      console.error("AWCA business spotlight unavailable:", error?.message || error);
      sendJson(res, 200, spotlightSlots([]), { cacheControl: "no-store" });
    }
  });
}

export default createHandler();
