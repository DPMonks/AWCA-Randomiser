import { createHash } from "node:crypto";
import { displayEntryRef } from "./privacy.js";
import { queryCollectionItems } from "./wix.js";

// Prepaid manual entries start with the November 2026 draw. Earlier months
// never include them, even if a row's cut-off is set in the past.
export const MANUAL_FIRST_MONTH = "2026-11";
export const DEFAULT_MANUAL_COLLECTION = "ManualEntrants";
const MAX_ENTRIES_PER_ADDRESS = 100;
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function manualCollectionId() {
  const configured = String(process.env.MANUAL_ENTRANTS_COLLECTION || "").trim();
  if (!configured) return DEFAULT_MANUAL_COLLECTION;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(configured)) return "";
  return configured;
}

export function isMonthKey(value) {
  return MONTH_KEY.test(String(value || "").trim());
}

export function normalizeManualEmail(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text.length > 254) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "";
  return text;
}

// lastDrawMonth is the last month whose draw includes this person.
// 2026-12 is in the November and December 2026 draws, and out in January 2027.
export function manualCoversDraw(lastDrawMonth, drawMonth) {
  const last = String(lastDrawMonth || "").trim();
  const draw = String(drawMonth || "").trim();
  if (!isMonthKey(last) || !isMonthKey(draw)) return false;
  if (draw < MANUAL_FIRST_MONTH) return false;
  return draw <= last;
}

export function manualEndInstant(monthKey) {
  const match = MONTH_KEY.exec(String(monthKey || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).toISOString();
}

export function manualMemberId(email, salt = 0) {
  const digest = createHash("sha256")
    .update(`awca-manual-entrant\n${email}\n${salt}`)
    .digest("hex")
    .slice(0, 32);
  return `m:${digest}`;
}

function entriesPerDraw(value) {
  if (value === undefined || value === null || value === "") return 1;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(number) || number < 1 || number > MAX_ENTRIES_PER_ADDRESS) return 0;
  return number;
}

function cleanName(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 80 || text.includes("@") || /[<>]/.test(text)) return "";
  return text;
}

function rowData(row) {
  if (!row || typeof row !== "object") return null;
  const data = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : row;
  if (data.entryRef && data.drawnAt) return null;
  return data;
}

function normalizeRow(row, index) {
  const data = rowData(row);
  if (!data) return null;
  const email = normalizeManualEmail(data.email);
  const lastDrawMonth = String(data.lastDrawMonth || "").trim();
  if (!email || !isMonthKey(lastDrawMonth)) return null;
  const count = entriesPerDraw(data.entriesPerDraw);
  if (!count) return null;
  const id = String(row?.id || row?._id || data._id || index).trim() || String(index);
  return {
    email,
    lastDrawMonth,
    entriesPerDraw: count,
    name: cleanName(data.name),
    id,
    index,
  };
}

function safeRef(memberId, entryNumber) {
  try {
    return displayEntryRef(memberId, entryNumber);
  } catch (error) {
    if (error?.code === "MISSING_ENTRY_SECRET") return "";
    throw error;
  }
}

function claimIdentity(email, count, usedRefs) {
  const needed = Math.max(1, count);
  for (let salt = 0; salt < 8; salt += 1) {
    const memberId = manualMemberId(email, salt);
    const refs = [];
    let clash = false;
    for (let number = 1; number <= needed; number += 1) {
      const ref = safeRef(memberId, number);
      if (ref && usedRefs.has(ref)) {
        clash = true;
        break;
      }
      refs.push(ref);
    }
    if (clash) continue;
    for (const ref of refs) {
      if (ref) usedRefs.add(ref);
    }
    return memberId;
  }
  return "";
}

function entryRow(item, memberId, entryNumber, active) {
  return {
    memberId,
    orderId: `manual:${item.index}:${item.id}`,
    name: item.name,
    email: item.email,
    status: active ? "Prepaid" : "Ended",
    active,
    pendingCancellation: false,
    startDate: null,
    endDate: manualEndInstant(item.lastDrawMonth),
    entryNumber: active ? entryNumber : 1,
    source: "manual",
  };
}

// Rows for the same address are one person. Their entry counts add together
// for months both rows still cover, and the entry codes stay on one sequence
// so the same address cannot take the same code twice. A plan order for that
// address is a different id and stays as its own entry.
export function buildManualEntries(rows, drawMonth, usedRefs = new Set()) {
  const parsed = [];
  let skipped = 0;
  for (let index = 0; index < (rows || []).length; index += 1) {
    const raw = rows[index];
    const data = raw?.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : raw;
    if (data && data.entryRef && data.drawnAt) continue;
    const row = normalizeRow(raw, index);
    if (!row) {
      skipped += 1;
      continue;
    }
    parsed.push(row);
  }

  const groups = new Map();
  for (const row of parsed) {
    const list = groups.get(row.email) || [];
    list.push(row);
    groups.set(row.email, list);
  }

  const entries = [];
  let capped = 0;
  for (const email of [...groups.keys()].sort()) {
    const list = groups.get(email).sort((a, b) => a.id.localeCompare(b.id) || a.index - b.index);
    const activeRows = list.filter((row) => manualCoversDraw(row.lastDrawMonth, drawMonth));
    let total = activeRows.reduce((sum, row) => sum + row.entriesPerDraw, 0);
    if (total > MAX_ENTRIES_PER_ADDRESS) {
      total = MAX_ENTRIES_PER_ADDRESS;
      capped += 1;
    }
    const memberId = claimIdentity(email, total, total > 0 ? usedRefs : new Set());
    if (!memberId) {
      skipped += list.length;
      continue;
    }
    let number = 1;
    let produced = 0;
    for (const item of list) {
      if (!manualCoversDraw(item.lastDrawMonth, drawMonth)) {
        entries.push(entryRow(item, memberId, 1, false));
        continue;
      }
      for (let i = 0; i < item.entriesPerDraw && produced < total; i += 1) {
        entries.push(entryRow(item, memberId, number, true));
        number += 1;
        produced += 1;
      }
    }
  }

  return { entries, skipped, capped };
}

// A successful query with no items is an empty collection. A missing
// collection or any other error is a failure: the page can continue, and a
// draw must not. Wix does not report an empty collection as "not found".
export async function readManualEntrantRows() {
  const collectionId = manualCollectionId();
  if (!collectionId) {
    return { ok: false, rows: [], status: 0, code: "BAD_COLLECTION_ID" };
  }
  try {
    const rows = await queryCollectionItems(collectionId);
    return { ok: true, rows, status: 200, code: "" };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      status: error?.wixStatus || 0,
      code: error?.code || "WIX_ERROR",
    };
  }
}

export function logManualReadFailure(result) {
  console.error(
    `AWCA manual entrants unavailable: collection=${manualCollectionId() || "invalid"} status=${result?.status || 0} code=${result?.code || "unknown"}`
  );
}

export function logManualRowNotes(notes) {
  if (notes?.skipped) {
    console.error(`AWCA manual entrants skipped ${notes.skipped} invalid rows`);
  }
  if (notes?.capped) {
    console.error(`AWCA manual entrants capped ${notes.capped} addresses at ${MAX_ENTRIES_PER_ADDRESS} entries`);
  }
}
