import { isMockMode } from "./mock.js";

// Preview and `vercel dev` share nothing with the live draw record.
// A missing VERCEL_ENV means this process is not a Vercel deployment (tests
// and a local node run), so the existing mock or live path stays available.
export function drawWritesAllowed() {
  if (isMockMode()) return true;
  const env = String(process.env.VERCEL_ENV || "").trim();
  if (!env) return true;
  return env === "production";
}

export const DRAW_BLOCKED_REASON = "Draws run only on the production deployment.";
