import { requireAdmin } from "../lib/auth.js";
import { asyncHandler, sendJson } from "../lib/http.js";
import { runDraw } from "../lib/lottery.js";

export default asyncHandler(async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  requireAdmin(req);
  sendJson(res, 200, await runDraw());
});
