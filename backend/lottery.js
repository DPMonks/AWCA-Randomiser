import { addSubscriber, cancelSubscriber, getStats } from "./subscribers.js";

/**
 * AWCA Lottery - /lottery endpoint
 * Receives events from Wix automations:
 *  - eventType: "subscribed" | "canceled"
 *  - subscriber: { name, email, plan, paymentConfirmed? }
 */

export async function lottery(request) {
  const body = await request.json();

  const { eventType, subscriber } = body || {};
  if (!eventType || !subscriber) {
    return new Response(
      JSON.stringify({ error: "Invalid payload" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log("AWCA Lottery event received:", { eventType, subscriber });

  if (eventType === "subscribed") {
    addSubscriber(subscriber);
  } else if (eventType === "canceled") {
    cancelSubscriber(subscriber);
  } else {
    console.log("Unknown eventType:", eventType);
  }

  const stats = getStats();

  return new Response(
    JSON.stringify({
      status: "processed",
      eventType,
      stats
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}
