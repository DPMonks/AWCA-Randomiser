import { adminCookie, clearAdminCookie, isSecureRequest, issueToken, passwordMatches } from "../lib/auth.js";
import { asyncHandler, readJson, sendJson } from "../lib/http.js";
import {
  assertAdminAllowed,
  clearAdminFailures,
  clientIp,
  lockError,
  rateStore,
  recordAdminFailure,
} from "../lib/rate-limit.js";

export function createSessionHandler({ store, now = () => Date.now() } = {}) {
  return asyncHandler(async (req, res) => {
    if (req.method === "DELETE") {
      res.setHeader("Set-Cookie", clearAdminCookie());
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const password = process.env.ADMIN_PASSWORD || "";
    if (!password) {
      sendJson(res, 503, {
        error: "Admin access is not configured. Set ADMIN_PASSWORD on the server.",
      });
      return;
    }

    const kv = store || rateStore(req);
    const ip = clientIp(req);
    await assertAdminAllowed(req, kv, now());

    const { password: attempt } = readJson(req);
    if (!passwordMatches(attempt, password)) {
      const failure = await recordAdminFailure(ip, kv, now());
      if (failure.locked) throw lockError(failure.retryAfter);
      sendJson(res, 401, { error: "That password is not correct." });
      return;
    }

    await clearAdminFailures(ip, kv);
    const token = issueToken(password);
    res.setHeader("Set-Cookie", adminCookie(token, { secure: isSecureRequest(req) }));
    sendJson(res, 200, { ok: true });
  });
}

export default createSessionHandler();
