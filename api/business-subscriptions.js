import { requireAdmin } from "../lib/auth.js";
import { getBusinessSubscriptions } from "../lib/business-report.js";
import { asyncHandler, sendJson } from "../lib/http.js";
import { kvStore } from "../lib/kv.js";
import { listOrdersForPlan, listPlans } from "../lib/wix.js";

export function createHandler(deps = { listPlans, listOrdersForPlan }) {
  return asyncHandler(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    await requireAdmin(req);
    const store = deps.statsStore || req.statsStore || kvStore();
    try {
      const body = await getBusinessSubscriptions(deps, process.env, { store });
      sendJson(res, 200, body, { cacheControl: "no-store" });
    } catch (error) {
      console.error("AWCA business subscriptions unavailable:", error?.message || error);
      sendJson(res, 200, {
        available: false,
        month: "",
        statsAvailable: false,
        subscriptions: [],
      }, { cacheControl: "no-store" });
    }
  });
}

export default createHandler();
