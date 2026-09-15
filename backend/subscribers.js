import { kv } from "@vercel/kv";

export async function addSubscriber(subscriber) {
  const { name, email, plan, paymentConfirmed } = subscriber;
  if (paymentConfirmed && paymentConfirmed !== "paid") return;

  const existing = (await kv.get("subscribers")) || [];
  const sameEmailCount = existing.filter(s => s.emailBase === email).length;
  const emailAlias = sameEmailCount === 0 ? email : `${email}(${sameEmailCount})`;

  const entry = { name, emailBase: email, email: emailAlias, plan };
  existing.push(entry);
  await kv.set("subscribers", existing);
  return entry;
}

export async function cancelSubscriber(subscriber) {
  const { email, plan } = subscriber;
  const existing = (await kv.get("subscribers")) || [];
  const idx = existing.findIndex(s => s.emailBase === email && s.plan === plan);
  if (idx !== -1) existing.splice(idx, 1);
  await kv.set("subscribers", existing);
}

export async function getStats() {
  const existing = (await kv.get("subscribers")) || [];
  const totalEntries = existing.length;
  const estimatedAmount = totalEntries * 1.25;
  return { totalEntries, estimatedAmount, pricePerSubscriber: 1.25 };
}

export async function getRandomWinner() {
  const existing = (await kv.get("subscribers")) || [];
  if (!existing.length) return null;
  const idx = Math.floor(Math.random() * existing.length);
  return existing[idx];
}
