import { asyncHandler, sendJson } from "../lib/http.js";
import { getPublicState } from "../lib/lottery.js";
import { readExtraDraws } from "../lib/mock-cookie.js";

export default asyncHandler(async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  sendJson(res, 200, await getPublicState(readExtraDraws(req)));
});
