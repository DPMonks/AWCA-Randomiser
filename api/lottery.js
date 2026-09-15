import { addSubscriber, cancelSubscriber } from "../backend/subscribers.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};
    const { eventType, subscriber, date } = body;

    if (!eventType || !subscriber) {
      return res.status(400).json({ error: "Missing eventType or subscriber" });
    }

    const { name, email, plan } = subscriber;

    if (eventType === "subscribed") {
      const entry = await addSubscriber({
        name,
        email,
        plan,
        date
      });
      return res.status(200).json({ status: "subscribed", entry });
    }

    if (eventType === "canceled") {
      await cancelSubscriber({
        email,
        plan,
        date
      });
      return res.status(200).json({ status: "canceled" });
    }

    return res.status(400).json({ error: "Unknown eventType" });
  } catch (err) {
    console.error("Lottery webhook error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
