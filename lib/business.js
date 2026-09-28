// Business supporters: active "AWCA Business Membership" subscribers.
// Public output is the business name, logo URL, website, and page slug.
// No member ids, personal names, or emails ever leave this module.
// updatedAt is the order time, used only for sitemap lastmod.

export const BUSINESS_PLAN_PRICE = 9.99;
export const MAX_NAME_LENGTH = 80;
export const MAX_SLUG_LENGTH = 80;

const NAME_KEY = /business|company|organi[sz]ation|trading|shop|brand/i;
const NOT_NAME_KEY = /logo|image|file|upload|e-?mail|phone|tel|web|url|site|address|post ?code|first|last|contact/i;
const LOGO_KEY = /logo|image|upload|file/i;
const WEBSITE_KEY = /website|web[_ -]?site|homepage|company[_ -]?site|(?:^|[_ -])url(?:$|[_ -])|(?:^|[_ -])site(?:$|[_ -])/i;
const NOT_WEBSITE_KEY = /e-?mail|logo|image|file|upload|phone|tel|address|post ?code|name|contact/i;
const ALLOWED_IMAGE_HOSTS = [/^static\.wixstatic\.com$/i, /\.wixstatic\.com$/i, /\.usrfiles\.com$/i, /^wixmp-[a-z0-9-]+\.wixmp\.com$/i];

function planAmounts(plan) {
  const amounts = [];
  const currency = String(plan?.currency || plan?.pricing?.price?.currency || "").toUpperCase();
  for (const variant of plan?.pricingVariants || []) {
    for (const strategy of variant?.pricingStrategies || []) {
      const amount = strategy?.flatRate?.amount;
      if (amount != null && amount !== "") amounts.push(Number(amount));
    }
  }
  const legacy = plan?.pricing?.price?.value;
  if (legacy != null && legacy !== "") amounts.push(Number(legacy));
  return { currency, amounts: amounts.filter((amount) => Number.isFinite(amount)) };
}

function isBusinessPrice(plan) {
  const { currency, amounts } = planAmounts(plan);
  const priced = amounts.some((amount) => Math.abs(amount - BUSINESS_PLAN_PRICE) < 0.001);
  return priced && (currency === "" || currency === "GBP");
}

function isBusinessName(plan) {
  return /business\s+membership/i.test(String(plan?.name || ""));
}

// WIX_BUSINESS_PLAN_ID wins. Otherwise the plan named "Business Membership",
// preferring the one priced 9.99 GBP. Returns { id, name } or null.
export function selectBusinessPlan(plans, configuredId) {
  const list = Array.isArray(plans) ? plans : [];
  const id = String(configuredId || "").trim();
  if (id) {
    const match = list.find((plan) => plan?.id === id);
    return { id, name: match?.name || "Business Membership" };
  }
  const named = list.filter(isBusinessName);
  const chosen = named.find(isBusinessPrice) || named[0] || null;
  return chosen ? { id: chosen.id, name: chosen.name } : null;
}

// Wix may return submission values as plain JSON or as protobuf Value
// wrappers ({ stringValue }, { listValue: { values } }, { structValue }).
export function unwrapValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(unwrapValue);
  if (typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("numberValue" in value) return value.numberValue;
  if ("boolValue" in value) return value.boolValue;
  if ("nullValue" in value) return null;
  if ("listValue" in value) return (value.listValue?.values || []).map(unwrapValue);
  if ("structValue" in value) return unwrapValue(value.structValue?.fields || value.structValue || {});
  if ("fields" in value && value.fields && typeof value.fields === "object" && Object.keys(value).length === 1) {
    return unwrapValue(value.fields);
  }
  const out = {};
  for (const [key, inner] of Object.entries(value)) out[key] = unwrapValue(inner);
  return out;
}

export function cleanBusinessName(value) {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.includes("@")) return "";
  return text.length > MAX_NAME_LENGTH ? `${text.slice(0, MAX_NAME_LENGTH - 3).trim()}...` : text;
}

function wixImageUriToUrl(uri) {
  // wix:image://v1/<mediaId>/<fileName>#originWidth=...
  const match = /^wix:image:\/\/v1\/([^/#?]+)/i.exec(uri);
  return match ? `https://static.wixstatic.com/media/${match[1]}` : "";
}

export function safeImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^wix:image:\/\//i.test(text)) return wixImageUriToUrl(text);
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";
  if (!ALLOWED_IMAGE_HOSTS.some((pattern) => pattern.test(url.hostname))) return "";
  return url.toString();
}

function urlFromFileValue(value) {
  const plain = unwrapValue(value);
  const items = Array.isArray(plain) ? plain : [plain];
  for (const item of items) {
    if (typeof item === "string") {
      const url = safeImageUrl(item);
      if (url) return url;
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const candidates = [item.url, item.fileUrl, item.src, item.uri, item.imageUrl, item.image?.url, item.file?.url];
    for (const candidate of candidates) {
      const url = safeImageUrl(candidate);
      if (url) return url;
    }
  }
  return "";
}

function entriesOf(submissionData) {
  const plain = unwrapValue(submissionData);
  if (!plain || typeof plain !== "object" || Array.isArray(plain)) return [];
  return Object.entries(plain);
}

export function extractBusinessName(submissionData, fieldKey = "") {
  const entries = entriesOf(submissionData);
  const key = String(fieldKey || "").trim();
  if (key) {
    const found = entries.find(([name]) => name === key);
    return cleanBusinessName(found?.[1]);
  }
  for (const [name, value] of entries) {
    if (!NAME_KEY.test(name) || NOT_NAME_KEY.test(name)) continue;
    const cleaned = cleanBusinessName(value);
    if (cleaned) return cleaned;
  }
  return "";
}

export function extractLogoUrl(submissionData, fieldKey = "") {
  const entries = entriesOf(submissionData);
  const key = String(fieldKey || "").trim();
  if (key) {
    const found = entries.find(([name]) => name === key);
    return found ? urlFromFileValue(found[1]) : "";
  }
  const preferred = entries.filter(([name]) => LOGO_KEY.test(name));
  for (const [, value] of [...preferred, ...entries]) {
    const url = urlFromFileValue(value);
    if (url) return url;
  }
  return "";
}

// http and https only. Host is lower case, the hash is dropped, and a
// trailing slash on the bare origin is removed. Anything with @ is rejected
// so a business email cannot be published as a website.
export function normaliseWebsite(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 300 || /\s|@/.test(text)) return "";
  if (!/^https?:\/\//i.test(text)) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (url.username || url.password) return "";
  const host = url.hostname.toLowerCase();
  if (!host || !host.includes(".") || host === "localhost") return "";
  url.hostname = host;
  url.hash = "";
  let out = url.toString();
  if (url.pathname === "/" && !url.search && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

function websiteFromValue(value) {
  const plain = unwrapValue(value);
  if (typeof plain === "string") return normaliseWebsite(plain);
  const items = Array.isArray(plain) ? plain : [plain];
  for (const item of items) {
    if (typeof item === "string") {
      const url = normaliseWebsite(item);
      if (url) return url;
      continue;
    }
    if (!item || typeof item !== "object") continue;
    for (const key of ["url", "href", "website", "value", "src"]) {
      const url = normaliseWebsite(item[key]);
      if (url) return url;
    }
  }
  return "";
}

function isWebsiteField(name) {
  return WEBSITE_KEY.test(name) && !NOT_WEBSITE_KEY.test(name);
}

export function extractWebsite(submissionData, fieldKey = "") {
  const entries = entriesOf(submissionData);
  const key = String(fieldKey || "").trim();
  if (key) {
    const found = entries.find(([name]) => name === key);
    return found ? websiteFromValue(found[1]) : "";
  }
  for (const [name, value] of entries) {
    if (!isWebsiteField(name)) continue;
    const url = websiteFromValue(value);
    if (url) return url;
  }
  return "";
}

// Stable, lowercase, hyphenated slug. The same business name always
// produces the same slug. Empty results become "business".
export function slugifyBusinessName(name) {
  const cleaned = cleanBusinessName(typeof name === "string" ? name : "");
  const ascii = cleaned
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/&/g, " and ")
    .toLocaleLowerCase("en-GB");
  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "business";
}

function slugSort(a, b) {
  const time = String(a.supporter.updatedAt || "").localeCompare(String(b.supporter.updatedAt || ""));
  if (time) return time;
  const byName = a.supporter.name.localeCompare(b.supporter.name, "en-GB", { sensitivity: "base" });
  if (byName) return byName;
  return a.index - b.index;
}

// Unique slugs. When two names share a base slug, the older subscription
// keeps the plain slug. The others get -2, -3, and so on, skipping any
// suffix that is already another business's slug.
export function assignSlugs(supporters) {
  const list = Array.isArray(supporters) ? supporters : [];
  const rows = list.map((supporter, index) => ({
    supporter,
    index,
    base: slugifyBusinessName(supporter?.name),
  }));
  const groups = new Map();
  for (const row of rows) {
    const bucket = groups.get(row.base) || [];
    bucket.push(row);
    groups.set(row.base, bucket);
  }
  const used = new Set();
  const slugs = new Array(list.length);
  const pending = [];
  for (const [base, bucket] of groups) {
    bucket.sort(slugSort);
    slugs[bucket[0].index] = base;
    used.add(base);
    pending.push(...bucket.slice(1));
  }
  pending.sort(slugSort);
  for (const row of pending) {
    let n = 2;
    let slug = `${row.base}-${n}`;
    while (used.has(slug)) {
      n += 1;
      slug = `${row.base}-${n}`;
    }
    used.add(slug);
    slugs[row.index] = slug;
  }
  return list.map((supporter, index) => ({ ...supporter, slug: slugs[index] }));
}

export function toPublicSupporter(supporter) {
  return {
    name: supporter.name,
    logoUrl: supporter.logoUrl || null,
    slug: supporter.slug,
    website: supporter.website || null,
  };
}

function orderTime(order) {
  return String(order?.startDate || order?.createdDate || order?.updatedDate || "");
}

// orders: raw Wix Pricing Plans v2 orders. Keeps ACTIVE orders for planId,
// one entry per buyer (newest order wins), then drops rows without a name.
export function buildSupporters(orders, { planId = "", nameField = "", logoField = "", websiteField = "" } = {}) {
  const newestByBuyer = new Map();
  for (const order of orders || []) {
    if (!order || order.status !== "ACTIVE") continue;
    if (planId && order.planId && order.planId !== planId) continue;
    const buyer = order.buyer?.memberId || order.buyer?.contactId || order.id;
    if (!buyer) continue;
    const current = newestByBuyer.get(buyer);
    if (!current || orderTime(order).localeCompare(orderTime(current)) > 0) newestByBuyer.set(buyer, order);
  }

  const seenNames = new Set();
  const supporters = [];
  for (const order of newestByBuyer.values()) {
    const data = order.formData?.submissionData || {};
    const name = extractBusinessName(data, nameField);
    if (!name) continue;
    const dedupeKey = name.toLocaleLowerCase("en-GB");
    if (seenNames.has(dedupeKey)) continue;
    seenNames.add(dedupeKey);
    const logoUrl = extractLogoUrl(data, logoField) || null;
    const website = extractWebsite(data, websiteField) || null;
    const updatedAt = orderTime(order) || null;
    supporters.push({ name, logoUrl, website, updatedAt });
  }
  supporters.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
  return assignSlugs(supporters);
}

export async function getBusinessSupporters(deps, env = process.env) {
  const plans = await deps.listPlans();
  const plan = selectBusinessPlan(plans, env.WIX_BUSINESS_PLAN_ID);
  if (!plan) return { available: true, supporters: [] };
  const orders = await deps.listOrdersForPlan(plan.id);
  const supporters = buildSupporters(orders, {
    planId: plan.id,
    nameField: env.WIX_BUSINESS_NAME_FIELD,
    logoField: env.WIX_BUSINESS_LOGO_FIELD,
    websiteField: env.WIX_BUSINESS_WEBSITE_FIELD,
  });
  return { available: true, supporters };
}
