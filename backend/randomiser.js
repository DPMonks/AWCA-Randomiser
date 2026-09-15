import { kv } from "@vercel/kv";
import { getStats, getRandomWinner } from "./subscribers.js";

export async function randomiser() {
  const stats = await getStats();
  const subscribers = await kv.get("subscribers") || [];

  let winner = null;
  let index = null;

  if (subscribers.length > 0) {
    index = Math.floor(Math.random() * subscribers.length);
    winner = subscribers[index];
  }

  return new Response(JSON.stringify({
    stats,
    winner,
    index,
    subscribers
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
