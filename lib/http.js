import { LotteryError } from "./errors.js";

export function sendJson(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(body));
}

export function readJson(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export function asyncHandler(fn) {
  return async function handler(req, res) {
    try {
      await fn(req, res);
    } catch (error) {
      const status = error.status || 500;
      const message = error instanceof LotteryError || error.status
        ? error.message
        : "Something went wrong. Please try again.";
      if (status >= 500) console.error(error);
      sendJson(res, status, { error: message });
    }
  };
}
