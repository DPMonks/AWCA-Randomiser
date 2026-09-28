import { LotteryError } from "./errors.js";
import { EMAIL_UNAVAILABLE, contactIdOf, subscriberEmail } from "./entrants.js";
import { normalizeDraw } from "./privacy.js";

const WIX_BASE = "https://www.wixapis.com";
const COLLECTION_ID = "LotteryDraws";

function credentials() {
  const key = process.env.WIX_API_KEY || "";
  const siteId = process.env.WIX_SITE_ID || "";
  if (!key || !siteId) {
    throw new LotteryError(
      "Wix is not configured. Add WIX_API_KEY and WIX_SITE_ID on the server.",
      503,
      "MISSING_WIX_CREDENTIALS"
    );
  }
  return { key, siteId };
}

export async function wixFetch(path, { method = "GET", body } = {}) {
  const { key, siteId } = credentials();
  const response = await fetch(`${WIX_BASE}${path}`, {
    method,
    headers: {
      Authorization: key,
      "wix-site-id": siteId,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 300) };
    }
  }

  if (!response.ok) {
    const detail = String(data?.message || data?.error || "").slice(0, 300);
    if (response.status === 401 || response.status === 403) {
      throw new LotteryError(
        "The Wix API key was rejected. Check that it can access this site and has Read Orders, Read Pricing Plans, Read Members, Read Contacts, Read Data Items, Write Data Items, and Manage Data Collections.",
        502,
        "WIX_FORBIDDEN"
      );
    }
    const error = new LotteryError(
      detail
        ? `Wix returned an error: ${detail}`
        : `Wix returned an error (${response.status}).`,
      502,
      "WIX_ERROR"
    );
    error.wixStatus = response.status;
    throw error;
  }

  return data || {};
}

export async function listPlans() {
  const plans = [];
  let cursor = null;
  for (let page = 0; page < 5; page += 1) {
    const query = cursor
      ? { cursorPaging: { limit: 100, cursor } }
      : { cursorPaging: { limit: 100 } };
    const data = await wixFetch("/pricing-plans/v3/plans/query", {
      method: "POST",
      body: { query },
    });
    const batch = data.plans || [];
    plans.push(...batch);
    cursor = data.pagingMetadata?.cursors?.next || null;
    if (!cursor || batch.length === 0) break;
  }
  return plans;
}

async function listOrdersPaged(planId, maxPages) {
  const orders = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams();
    if (planId) params.append("planIds", planId);
    params.set("limit", "50");
    params.set("offset", String(offset));
    const data = await wixFetch(`/pricing-plans/v2/orders?${params.toString()}`);
    const batch = data.orders || [];
    orders.push(...batch);
    const total = data.pagingMetadata?.total;
    offset += batch.length;
    const hasNext = data.pagingMetadata?.hasNext;
    if (batch.length === 0 || batch.length < 50 || hasNext === false || (Number.isFinite(total) && offset >= total)) {
      break;
    }
  }
  return orders;
}

export async function listOrdersForPlan(planId) {
  return listOrdersPaged(planId, 20);
}

export async function listAllOrders() {
  return listOrdersPaged("", 40);
}

const MEMBERS_PAGE_SIZE = 100;

export async function listAllMembers() {
  const members = [];
  let offset = 0;
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const paging = cursor
      ? { limit: MEMBERS_PAGE_SIZE, cursor }
      : { limit: MEMBERS_PAGE_SIZE, offset };
    const data = await wixFetch("/members/v1/members/query", {
      method: "POST",
      body: {
        fieldsets: ["FULL"],
        query: { paging },
      },
    });
    const batch = data.members || [];
    members.push(...batch);
    const meta = data.metadata || data.pagingMetadata || {};
    const next = meta.cursors?.next || data.pagingMetadata?.cursors?.next || null;
    if (next) {
      cursor = next;
      continue;
    }
    cursor = null;
    const total = Number(meta.total);
    offset += batch.length;
    if (batch.length === 0 || batch.length < MEMBERS_PAGE_SIZE) break;
    if (Number.isFinite(total) && offset >= total) break;
  }
  return members;
}

export async function memberNames(memberIds) {
  const names = new Map();
  const ids = [...new Set(memberIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 50) {
    const slice = ids.slice(i, i + 50);
    const data = await wixFetch("/members/v1/members/query", {
      method: "POST",
      body: {
        fieldsets: ["FULL"],
        query: {
          filter: { id: { $in: slice } },
          paging: { limit: 100 },
        },
      },
    });
    for (const member of data.members || []) {
      names.set(member.id, member);
    }
  }
  return names;
}

export async function contactPrimaryEmails(contactIds) {
  const emails = new Map();
  const ids = [...new Set(contactIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 50) {
    const slice = ids.slice(i, i + 50);
    const data = await wixFetch("/contacts/v4/contacts/query", {
      method: "POST",
      body: {
        query: {
          filter: { id: { $in: slice } },
          paging: { limit: slice.length },
        },
        fieldsets: ["COMMUNICATION_DETAILS"],
      },
    });
    for (const contact of data.contacts || []) {
      const email = subscriberEmail(contact);
      if (email && contact.id) emails.set(contact.id, email);
    }
  }
  return emails;
}

// Login email from Members (FULL fieldset, Read Members). If that is empty,
// the contact primary email (Read Contacts). A forbidden contacts call is
// reported as EMAIL_UNAVAILABLE instead of failing the member list.
export async function resolveMemberEmails(rawMembers) {
  const emails = new Map();
  const pending = [];
  for (const [id, member] of rawMembers || []) {
    const email = subscriberEmail(member);
    if (email) {
      emails.set(id, email);
      continue;
    }
    const contactId = contactIdOf(member);
    if (contactId) pending.push({ id, contactId });
  }
  if (pending.length === 0) return emails;
  try {
    const found = await contactPrimaryEmails(pending.map((row) => row.contactId));
    for (const row of pending) {
      const email = found.get(row.contactId);
      if (email) emails.set(row.id, email);
    }
  } catch (error) {
    if (error?.code !== "WIX_FORBIDDEN") throw error;
    console.error(
      "AWCA member emails unavailable: add Read Contacts (SCOPE.DC-CONTACTS.READ-CONTACTS) to the Wix API key. Member login emails also need Read Members (SCOPE.DC-MEMBERS.READ-MEMBERS) with the FULL fieldset."
    );
    for (const row of pending) {
      if (!emails.has(row.id)) emails.set(row.id, EMAIL_UNAVAILABLE);
    }
  }
  return emails;
}

export function drawCollectionSpec() {
  return {
    id: COLLECTION_ID,
    displayName: "Lottery Draws",
    displayField: "entryRef",
    fields: [
      { key: "memberId", displayName: "Member id", type: "TEXT" },
      { key: "initials", displayName: "Initials", type: "TEXT" },
      { key: "entryRef", displayName: "Entry reference", type: "TEXT" },
      { key: "month", displayName: "Month", type: "TEXT" },
      { key: "drawnAt", displayName: "Drawn at", type: "TEXT" },
      { key: "entryCount", displayName: "Entry count", type: "NUMBER" },
      { key: "potAmount", displayName: "Pot", type: "NUMBER" },
      { key: "fingerprint", displayName: "Fairness fingerprint", type: "TEXT" },
      { key: "entrantsHash", displayName: "Entrants hash", type: "TEXT" },
      { key: "winnerIndex", displayName: "Winner index", type: "NUMBER" },
    ],
    permissions: {
      insert: "ADMIN",
      update: "ADMIN",
      remove: "ADMIN",
      read: "ADMIN",
    },
  };
}

function collectionBody() {
  return { collection: drawCollectionSpec() };
}

function missingCollection(error) {
  if (error?.wixStatus === 404) return true;
  return /does not exist|not found|unknown collection/i.test(String(error?.message || ""));
}

function alreadyExists(error) {
  return /already exists|ALREADY_EXISTS|duplicate/i.test(String(error?.message || ""));
}

async function createDrawCollection() {
  try {
    await wixFetch("/wix-data/v2/collections", {
      method: "POST",
      body: collectionBody(),
    });
    console.log("Created Wix CMS collection LotteryDraws for draw history.");
  } catch (error) {
    if (!alreadyExists(error)) throw error;
  }
}

async function withDrawCollection(action) {
  try {
    return await action();
  } catch (error) {
    if (!missingCollection(error)) throw error;
    await createDrawCollection();
    return action();
  }
}

export function toDrawRecord(item) {
  const data = item?.data || item || {};
  return normalizeDraw({
    ...data,
    month: data.month || item?.id || "",
    drawnAt: data.drawnAt || item?._createdDate || null,
  });
}

const FINGERPRINT_FIELD_KEYS = new Set(["fingerprint", "entrantsHash", "winnerIndex"]);

function drawItemData(draw) {
  const data = {
    memberId: draw.memberId,
    initials: draw.initials,
    entryRef: draw.entryRef,
    month: draw.month,
    drawnAt: draw.drawnAt,
    entryCount: draw.entryCount,
    potAmount: draw.potAmount,
  };
  if (draw.fingerprint) data.fingerprint = draw.fingerprint;
  if (draw.entrantsHash) data.entrantsHash = draw.entrantsHash;
  if (Number.isInteger(draw.winnerIndex) && draw.winnerIndex >= 0) data.winnerIndex = draw.winnerIndex;
  return data;
}

async function ensureFingerprintFields() {
  const data = await wixFetch(`/wix-data/v2/collections/${encodeURIComponent(COLLECTION_ID)}`);
  const collection = data.collection || data.dataCollection || {};
  const keys = new Set((collection.fields || []).map((field) => field.key));
  for (const field of drawCollectionSpec().fields) {
    if (!FINGERPRINT_FIELD_KEYS.has(field.key) || keys.has(field.key)) continue;
    try {
      await wixFetch("/wix-data/v2/collections/create-field", {
        method: "POST",
        body: { dataCollectionId: COLLECTION_ID, field },
      });
    } catch (error) {
      if (!alreadyExists(error)) throw error;
    }
  }
}

function isDuplicateItem(error) {
  if (error?.wixStatus === 409) return true;
  return /already exists|ALREADY_EXISTS|duplicate|WDE0073|WDE0007/i.test(String(error?.message || ""));
}

export async function queryDraws() {
  return withDrawCollection(async () => {
    const data = await wixFetch("/wix-data/v2/items/query", {
      method: "POST",
      body: {
        dataCollectionId: COLLECTION_ID,
        consistentRead: true,
        query: {
          sort: [{ fieldName: "drawnAt", order: "DESC" }],
          paging: { limit: 24 },
        },
      },
    });
    return (data.dataItems || []).map(toDrawRecord);
  });
}

export async function readDrawByMonth(month) {
  return withDrawCollection(async () => {
    const id = encodeURIComponent(month);
    try {
      const data = await wixFetch(`/wix-data/v2/items/${id}?dataCollectionId=${COLLECTION_ID}`);
      const item = data.dataItem || data;
      if (item?.data || item?.id) {
        const record = toDrawRecord(item);
        if (record?.month === month) return record;
      }
    } catch (error) {
      if (error?.wixStatus !== 404 && !/not found/i.test(String(error?.message || ""))) throw error;
    }
    const data = await wixFetch("/wix-data/v2/items/query", {
      method: "POST",
      body: {
        dataCollectionId: COLLECTION_ID,
        consistentRead: true,
        query: {
          filter: { month: { $eq: month } },
          paging: { limit: 1 },
        },
      },
    });
    const item = (data.dataItems || [])[0];
    return item ? toDrawRecord(item) : null;
  });
}

export async function insertDraw(draw) {
  const saved = await insertDrawIfAbsent(draw);
  return saved.record;
}

export async function insertDrawIfAbsent(draw) {
  try {
    await withDrawCollection(async () => {
      await ensureFingerprintFields();
      await wixFetch("/wix-data/v2/items", {
        method: "POST",
        body: {
          dataCollectionId: COLLECTION_ID,
          dataItem: {
            id: draw.month,
            data: drawItemData(draw),
          },
        },
      });
    });
    return { record: toDrawRecord({ id: draw.month, data: drawItemData(draw) }), created: true };
  } catch (error) {
    if (!isDuplicateItem(error)) throw error;
    const existing = await readDrawByMonth(draw.month);
    if (!existing) throw error;
    return { record: existing, created: false };
  }
}
