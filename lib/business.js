// Business supporters: active "AWCA Business Membership" subscribers.
// Public output is the business name and logo URL only. No member ids,
// personal names or emails ever leave this module.

export const BUSINESS_PLAN_PRICE = 9.99;
export const MAX_NAME_LENGTH = 80;

const NAME_KEY = /business|company|organi[sz]ation|trading|shop|brand/i;
const NOT_NAME_KEY = /logo|image|file|upload|e-?mail|phone|tel|web|url|site|address|post ?code|first|last|contact/i;
const LOGO_KEY = /logo|image|upload|file/i;
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

function orderTime(order) {
  return String(order?.startDate || order?.createdDate || order?.updatedDate || "");
}

// orders: raw Wix Pricing Plans v2 orders. Keeps ACTIVE orders for planId,
// one entry per buyer (newest order wins), then drops rows without a name.
export function buildSupporters(orders, { planId = "", nameField = "", logoField = "" } = {}) {
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
    const logoUrl = extractLogoUrl(data, logoField);
    supporters.push(logoUrl ? { name, logoUrl } : { name, logoUrl: null });
  }
  supporters.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
  return supporters;
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
  });
  return { available: true, supporters };
}
