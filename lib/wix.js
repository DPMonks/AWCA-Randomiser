import { LotteryError } from "./errors.js";

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
        "The Wix API key was rejected. Check that it can access this site and has Read Orders, Read Pricing Plans, Read Members, Read Data Items, Write Data Items, and Manage Data Collections.",
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

export async function listOrdersForPlan(planId) {
  const orders = [];
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams();
    params.append("planIds", planId);
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

function collectionBody() {
  return {
    collection: {
      id: COLLECTION_ID,
      displayName: "Lottery Draws",
      displayField: "winnerName",
      fields: [
        { key: "winnerName", displayName: "Winner name", type: "TEXT" },
        { key: "winnerMemberId", displayName: "Winner member id", type: "TEXT" },
        { key: "drawnAt", displayName: "Drawn at", type: "TEXT" },
        { key: "entryCount", displayName: "Entry count", type: "NUMBER" },
        { key: "potAmount", displayName: "Pot amount", type: "NUMBER" },
      ],
      permissions: {
        insert: "ADMIN",
        update: "ADMIN",
        remove: "ADMIN",
        read: "ADMIN",
      },
    },
  };
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
  return {
    winnerName: data.winnerName || "Winner",
    winnerMemberId: data.winnerMemberId || "",
    drawnAt: data.drawnAt || item?._createdDate || null,
    entryCount: Number(data.entryCount) || 0,
    potAmount: Number(data.potAmount) || 0,
  };
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

export async function insertDraw(draw) {
  await withDrawCollection(async () => {
    await wixFetch("/wix-data/v2/items", {
      method: "POST",
      body: {
        dataCollectionId: COLLECTION_ID,
        dataItem: {
          data: {
            winnerName: draw.winnerName,
            winnerMemberId: draw.winnerMemberId,
            drawnAt: draw.drawnAt,
            entryCount: draw.entryCount,
            potAmount: draw.potAmount,
          },
        },
      },
    });
  });
}
