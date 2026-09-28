import { londonParts } from "./format.js";

export const SPOTLIGHT_COUNT = 4;
export const PRICING_URL = "https://www.alconbury-weald.org/pricing-plans/plans-pricing";
export const PLACEHOLDER_LABEL = "Your business here";

export function londonDateKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const parts = londonParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function seedFrom(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function spotlightOrder(supporters, now = new Date()) {
  const date = londonDateKey(now);
  const list = (Array.isArray(supporters) ? supporters : []).filter((item) => item && item.slug && item.name);
  const rand = mulberry32(seedFrom(`awca-spotlight:${date}`));
  const shuffled = list.map((item) => ({
    name: item.name,
    slug: item.slug,
    logoUrl: item.logoUrl || null,
  }));
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swap = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = swap;
  }
  return { date, supporters: shuffled };
}

export function spotlightSlots(supporters, now = new Date()) {
  const picked = spotlightOrder(supporters, now);
  const slots = picked.supporters.slice(0, SPOTLIGHT_COUNT).map((item) => ({
    kind: "business",
    name: item.name,
    slug: item.slug,
    logoUrl: item.logoUrl,
  }));
  while (slots.length < SPOTLIGHT_COUNT) {
    slots.push({ kind: "placeholder", label: PLACEHOLDER_LABEL, href: PRICING_URL });
  }
  return { date: picked.date, slots };
}
