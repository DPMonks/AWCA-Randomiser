import { createHmac } from "node:crypto";
import { LotteryError } from "./errors.js";
import { londonParts } from "./format.js";

const MOCK_ENTRY_SECRET = "awca-mock-entry-ref";

function letterOf(part) {
  const match = String(part).match(/\p{L}/u);
  return match ? match[0].toLocaleUpperCase("en-GB") : "";
}

export function initialsFromName(name) {
  const cleaned = String(name || "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.toLocaleLowerCase("en-GB") === "member") return "";

  const tokens = cleaned.split(" ").filter(Boolean);
  const chosen = tokens.length === 1 ? tokens : [tokens[0], tokens[tokens.length - 1]];
  const parts = chosen.flatMap((token) => token.split("-").filter(Boolean));
  const letters = parts.map(letterOf).filter(Boolean);
  if (letters.length === 0) return "";
  return `${letters.join(".")}.`;
}

function storedInitials(value) {
  const text = String(value || "").trim();
  if (!text || /\s|@/.test(text)) return "";
  if (!/^[\p{L}.]+$/u.test(text) || !text.includes(".")) return "";
  return text;
}

function entrySecret() {
  const dedicated = String(process.env.ENTRY_REF_SECRET || "").trim();
  if (dedicated) return dedicated;
  const admin = String(process.env.ADMIN_PASSWORD || "").trim();
  if (admin) return admin;
  const mock = String(process.env.WIX_MOCK || "").trim().toLowerCase();
  if (mock === "1" || mock === "true" || mock === "yes") return MOCK_ENTRY_SECRET;
  return "";
}

export function entryReference(memberId) {
  const id = String(memberId || "").trim();
  if (!id) return "";
  const secret = entrySecret();
  if (!secret) {
    throw new LotteryError(
      "Set ENTRY_REF_SECRET (or ADMIN_PASSWORD) so each member has a stable entry reference.",
      503,
      "MISSING_ENTRY_SECRET"
    );
  }
  return createHmac("sha256", secret).update(id).digest("hex").slice(0, 6).toUpperCase();
}

export function publicWinnerLabel({ initials, entryRef } = {}) {
  const letters = storedInitials(initials) || "";
  const ref = String(entryRef || "").trim();
  if (letters && ref) return `${letters} - Entry ${ref}`;
  if (ref) return `Entry ${ref}`;
  if (letters) return letters;
  return "Winner";
}

export function drawMonth(drawnAt) {
  if (!drawnAt) return "";
  const date = drawnAt instanceof Date ? drawnAt : new Date(drawnAt);
  if (Number.isNaN(date.getTime())) return "";
  const parts = londonParts(date);
  return `${parts.year}-${parts.month}`;
}

export function normalizeDraw(draw) {
  if (!draw || typeof draw !== "object") return null;
  const memberId = String(draw.memberId || draw.winnerMemberId || "").trim();
  let initials = storedInitials(draw.initials);
  if (!initials && draw.winnerName) initials = initialsFromName(draw.winnerName);
  const storedRef = String(draw.entryRef || "").trim();
  const entryRef = /^[0-9A-F]{6}$/.test(storedRef) ? storedRef : entryReference(memberId);
  const drawnAt = draw.drawnAt || null;
  return {
    memberId,
    initials,
    entryRef,
    month: String(draw.month || "").trim() || drawMonth(drawnAt),
    drawnAt,
    entryCount: Number(draw.entryCount) || 0,
    potAmount: Number(draw.potAmount) || 0,
  };
}
