const PRICE_PER_SUBSCRIBER = 1.25;

let subscribers = [];

/**
 * Add a subscriber, handling:
 * - payment confirmation
 * - duplicate email entries (email, email(1), email(2)...)
 */
export function addSubscriber(subscriber) {
  const { name, email, plan, paymentConfirmed } = subscriber;

  // Only add if payment is confirmed as "paid" or not provided
  if (paymentConfirmed && paymentConfirmed !== "paid") {
    console.log("Payment not confirmed, skipping subscriber:", email, plan, paymentConfirmed);
    return;
  }

  const emailBase = email;
  const sameEmailCount = subscribers.filter(s => s.emailBase === emailBase).length;
  const emailAlias = sameEmailCount === 0 ? emailBase : `${emailBase}(${sameEmailCount})`;

  const entry = {
    name,
    emailBase,
    email: emailAlias,
    plan
  };

  subscribers.push(entry);
  console.log("Subscriber added:", entry);
}

/**
 * Cancel a subscriber:
 * - Wix sends the base email (no alias)
 * - We remove ONE matching entry for that email + plan
 */
export function cancelSubscriber(subscriber) {
  const { email, plan } = subscriber;
  const emailBase = email;

  const idx = subscribers.findIndex(
    s => s.emailBase === emailBase && s.plan === plan
  );

  if (idx !== -1) {
    const removed = subscribers.splice(idx, 1)[0];
    console.log("Subscriber cancelled:", removed);
  } else {
    console.log("No matching subscriber found to cancel:", emailBase, plan);
  }
}

/**
 * Stats:
 * - totalEntries: number of active entries
 * - estimatedAmount: totalEntries * PRICE_PER_SUBSCRIBER
 */
export function getStats() {
  const totalEntries = subscribers.length;
  const estimatedAmount = totalEntries * PRICE_PER_SUBSCRIBER;

  return {
    totalEntries,
    estimatedAmount,
    pricePerSubscriber: PRICE_PER_SUBSCRIBER
  };
}

/**
 * Random winner from current subscribers.
 */
export function getRandomWinner() {
  if (!subscribers.length) return null;

  const idx = Math.floor(Math.random() * subscribers.length);
  return subscribers[idx];
}
