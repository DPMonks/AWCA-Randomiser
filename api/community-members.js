import { requireAdmin } from "../lib/auth.js";
import { getCommunityMembers } from "../lib/community.js";
import { asyncHandler, sendJson } from "../lib/http.js";

export default asyncHandler(async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  await requireAdmin(req);
  sendJson(res, 200, await getCommunityMembers());
});
