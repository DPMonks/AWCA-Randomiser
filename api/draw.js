import { requireAdmin } from "../lib/auth.js";
import { asyncHandler, sendJson } from "../lib/http.js";
import { runDraw } from "../lib/lottery.js";
import { rememberDraw } from "../lib/mock-cookie.js";

export default asyncHandler(async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  requireAdmin(req);
  const result = await runDraw();
  rememberDraw(req, res, result.record);
  sendJson(res, 200, { mock: result.mock, winner: result.winner });
});
