import { kv } from "@vercel/kv";

export async function addSubscriber({ name, email, plan, date }) {
  const existing = (await kv.get("subscribers")) || [];

  const sameEmailCount = existing.filter(s => s.emailBase === email).length;
  const emailAlias = sameEmailCount === 0 ? email : `${email}(${sameEmailCount})`;

  const entry = {
    name,
    emailBase: email,
    email: emailAlias,
    plan,
    joinedAt: date || new Date().toISOString()
  };

  existing.push(entry);
  await kv.set("subscribers", existing);

  return entry;
}

export async function cancelSubscriber({ email, plan, date }) {
  const existing = (await kv.get("subscribers")) || [];
  const filtered = existing.filter(
    s => !(s.emailBase === email && s.plan === plan)
  );

  await kv.set("subscribers", filtered);

  return { canceledAt: date || new Date().toISOString() };
}

export async function getStats() {
  const existing = (await kv.get("subscribers")) || [];
  const totalEntries = existing.length;
  const estimatedAmount = totalEntries * 1.25;
  return { totalEntries, estimatedAmount };
}
