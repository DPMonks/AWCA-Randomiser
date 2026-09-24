import { adminCookie, clearAdminCookie, isSecureRequest, issueToken, passwordMatches } from "../lib/auth.js";
import { asyncHandler, readJson, sendJson } from "../lib/http.js";

export default asyncHandler(async (req, res) => {
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

  const { password: attempt } = readJson(req);
  if (!passwordMatches(attempt, password)) {
    sendJson(res, 401, { error: "That password is not correct." });
    return;
  }

  const token = issueToken(password);
  res.setHeader("Set-Cookie", adminCookie(token, { secure: isSecureRequest(req) }));
  sendJson(res, 200, { ok: true });
});
