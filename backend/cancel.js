/**
 * AWCA Lottery - Cancellation helper
 * To be called from lottery.js when eventType === "canceled".
 */

export function handleCancellation(subscriber) {
  const { email, plan } = subscriber;

  return {
    status: "pending-implementation",
    message: `Cancellation received for ${email} on plan ${plan}`
  };
}
