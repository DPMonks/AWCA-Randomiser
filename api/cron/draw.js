import { requireCron } from "../../lib/auth.js";
import { asyncHandler, sendJson } from "../../lib/http.js";
import { ensureMonthlyDraw } from "../../lib/lottery.js";
import { publicWinnerLabel } from "../../lib/privacy.js";

export default asyncHandler(async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  requireCron(req);
  const now = req.drawNow instanceof Date ? req.drawNow : new Date();
  const result = await ensureMonthlyDraw({ now, force: false });
  if (result.status === "not-due") {
    sendJson(res, 200, {
      ok: true,
      created: false,
      skipped: true,
      reason: "Before 20:00 UK time on the 1st.",
    });
    return;
  }
  const record = result.record;
  sendJson(res, 200, {
    ok: true,
    created: Boolean(result.created),
    month: record?.month || result.month || "",
    label: record ? publicWinnerLabel(record) : "",
    entryRef: record?.entryRef || "",
  });
});
