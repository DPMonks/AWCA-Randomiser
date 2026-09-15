/**
 * AWCA Lottery - /lottery endpoint
 * Receives events from Wix automations:
 *  - eventType: "subscribed" | "canceled"
 *  - subscriber: { name, email, plan, paymentConfirmed? }
 */

export async function lottery(request) {
  const body = await request.json();

  const { eventType, subscriber } = body;
  const { email, plan, paymentConfirmed } = subscriber || {};

  console.log("AWCA Lottery event received:", {
    eventType,
    email,
    plan,
    paymentConfirmed
  });

  return new Response(
    JSON.stringify({
      status: "received",
      eventType,
      email,
      plan
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}
