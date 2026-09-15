import { kv } from "@vercel/kv";
import { getStats } from "../backend/subscribers.js";

export default async function handler(req, res) {
  try {
    const subscribers = await kv.get("subscribers") || [];
    const stats = await getStats();

    let winner = null;
    let index = null;

    if (subscribers.length > 0) {
      index = Math.floor(Math.random() * subscribers.length);
      winner = subscribers[index];

      // Log monthly winner
      const log = (await kv.get("monthly_draws")) || [];
      log.push({
        timestamp: new Date().toISOString(),
        winner,
        index,
        totalEntries: stats.totalEntries,
        totalWinnings: stats.estimatedAmount
      });
      await kv.set("monthly_draws", log);
    }

    res.status(200).json({
      status: "monthly_draw_complete",
      timestamp: new Date().toISOString(),
      winner,
      index,
      stats
    });
  } catch (err) {
    console.error("Scheduled draw error:", err);
    res.status(500).json({ error: "Scheduled draw failed", details: err.message });
  }
}
