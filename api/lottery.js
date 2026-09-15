import { lottery } from "../backend/lottery.js";

export default async function handler(req, res) {
  try {
    const response = await lottery({
      json: async () => req.body
    });

    const text = await response.text();
    res.status(response.status).setHeader("Content-Type", "application/json");
    res.send(text);
  } catch (err) {
    console.error("Lottery function error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
}
