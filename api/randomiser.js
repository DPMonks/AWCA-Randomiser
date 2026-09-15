import { randomiser } from "../backend/randomiser.js";

export default async function handler(req, res) {
  try {
    const response = await randomiser();
    const text = await response.text();
    res.status(response.status).setHeader("Content-Type", "application/json");
    res.send(text);
  } catch (err) {
    console.error("Randomiser function error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
}
