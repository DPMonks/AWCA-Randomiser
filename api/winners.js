import { asyncHandler, sendJson } from "../lib/http.js";
import { getPublicWinners } from "../lib/lottery.js";

export const WINNERS_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";

export default asyncHandler(async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const body = await getPublicWinners();
  sendJson(res, 200, body, {
    cacheControl: body.historyAvailable ? WINNERS_CACHE_CONTROL : "no-store",
  });
});
