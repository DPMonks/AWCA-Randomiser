import { createHash } from "node:crypto";
import { drawWritesAllowed } from "./draw-guard.js";
import { monthKeyLabel } from "./format.js";
import { normalizeManualEmail } from "./manual-entrants.js";
import { entryNumberFromRef, initialsFromName, normalizeDraw } from "./privacy.js";
import { insertMailClaim, listDraws, markMailClaim, readMailClaim, removeMailClaim } from "./store.js";
import { mailClaimId } from "./wix.js";

export const DEFAULT_NOTIFY_COPIES = [
  "secretary@alconbury-weald.org",
  "community-association@alconbury-weald.org",
];

const CLAIM_MS = 2 * 60 * 1000;
const noted = new Set();

function noteOnce(key, message) {
  if (noted.has(key)) return;
  noted.add(key);
  console.error(message);
}

export function mailMode() {
  const env = String(process.env.VERCEL_ENV || "").trim();
  const dry = /^(1|true|yes)$/i.test(String(process.env.EMAIL_DRY_RUN || "").trim());
  if ((env && env !== "production") || dry) return "dry";
  if (String(process.env.EMAIL_ENABLED || "").trim() === "true") return "live";
  return "off";
}

export function notifyCopyEmails() {
  const raw = process.env.NOTIFY_COPY_EMAILS;
  if (raw === undefined || !String(raw).trim()) return [...DEFAULT_NOTIFY_COPIES];
  const seen = new Set();
  const list = [];
  let dropped = 0;
  for (const part of String(raw).split(",")) {
    const email = normalizeManualEmail(part);
    if (!email) {
      if (part.trim()) dropped += 1;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    list.push(email);
  }
  if (dropped) console.error(`AWCA notify copies ignored ${dropped} invalid addresses`);
  return list;
}

export function recipientKey(address) {
  return createHash("sha256")
    .update(`awca-mail\n${String(address || "").trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

export function winnerMail({ monthLabel, entryRef, potLabel }) {
  return {
    subject: `AWCA Lottery winner for ${monthLabel}`,
    text: [
      "Congratulations.",
      "",
      `Your entry ${entryRef} has won the AWCA Lottery for ${monthLabel}.`,
      "",
      `The prize is ${potLabel}.`,
      "",
      "AWCA will be in touch about the prize.",
      "",
      "This note is only about your winning entry.",
    ].join("\n"),
  };
}

export function copyMail({ monthLabel, name, initials, email, entryRef, potLabel, month }) {
  return {
    subject: `AWCA Lottery result for ${monthLabel}`,
    text: [
      `The AWCA Lottery draw for ${monthLabel} has a winner.`,
      "",
      `Name: ${name || "Not recorded"}`,
      `Initials: ${initials || "None"}`,
      `Email: ${email || "Unavailable"}`,
      `Entry code: ${entryRef}`,
      `Prize pot: ${potLabel}`,
      `Draw month: ${month}`,
      "",
      "Please contact the winner about the prize.",
    ].join("\n"),
  };
}

function potLabelOf(amount) {
  const number = Number(amount);
  if (!Number.isFinite(number)) return "Unavailable";
  return `£${number.toFixed(2)}`;
}

function personFor(draw, members) {
  const number = entryNumberFromRef(draw?.entryRef);
  const list = members || [];
  return (
    list.find((member) => member?.memberId === draw?.memberId && (Number(member.entryNumber) || 1) === number) ||
    list.find((member) => member?.memberId === draw?.memberId) ||
    null
  );
}

function buildJobs(draw, person) {
  const month = draw.month;
  const monthLabel = monthKeyLabel(month) || month;
  const potLabel = potLabelOf(draw.potAmount);
  const entryRef = draw.entryRef;
  const address = normalizeManualEmail(person?.email);
  const name = String(person?.name || "").trim();
  const initials = draw.initials || initialsFromName(name);
  const winner = winnerMail({ monthLabel, entryRef, potLabel });
  const copy = copyMail({
    monthLabel,
    name,
    initials,
    email: address,
    entryRef,
    potLabel,
    month,
  });
  const jobs = [
    {
      role: "winner",
      key: address ? recipientKey(address) : "",
      address,
      subject: winner.subject,
      text: winner.text,
    },
  ];
  for (const copyAddress of notifyCopyEmails()) {
    jobs.push({
      role: "copy",
      key: recipientKey(copyAddress),
      address: copyAddress,
      subject: copy.subject,
      text: copy.text,
    });
  }
  return jobs;
}

function claimFresh(claim, now) {
  const at = Date.parse(claim?.claimedAt || "");
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at < CLAIM_MS;
}

// Insert is the lock. A duplicate id means someone else owns this recipient.
// A failed or stale claim is removed and inserted again. A sent claim is never removed.
async function takeClaim(job, month, mode, now) {
  const id = mailClaimId(month, job.role, job.key, mode);
  const payload = {
    id,
    month,
    role: job.role,
    key: job.key,
    mode,
    claimedAt: now.toISOString(),
  };
  const first = await insertMailClaim(payload);
  if (first.inserted) return { owned: true, id };
  const existing = await readMailClaim(id);
  if (!existing || existing.status === "sent") return { owned: false, id };
  if (existing.status === "claimed" && claimFresh(existing, now)) return { owned: false, id };
  const removed = await removeMailClaim(id);
  if (!removed) return { owned: false, id };
  const second = await insertMailClaim({ ...payload, claimedAt: new Date().toISOString() });
  return { owned: Boolean(second.inserted), id };
}

async function rememberClaim(id, status, detail) {
  try {
    await markMailClaim(id, { status, detail, claimedAt: new Date().toISOString() });
    return true;
  } catch (error) {
    console.error(`AWCA draw mail claim was not saved: status=${error?.wixStatus || 0} code=${error?.code || "ERROR"}`);
    return false;
  }
}

function safeMailError(error) {
  if (error?.code === "NO_TEST_INBOX") return "test inbox is not set";
  if (error?.code === "SENDER_NOT_SET") return "sender is not set";
  if (error?.code === "MAIL_KEY_NOT_SET") return "mail provider key is not set";
  if (error?.code === "MAIL_PROVIDER") return `mail provider status ${Number(error.status) || 0}`;
  return "mail provider status 0";
}

async function readDraw(month) {
  const stored = await listDraws();
  if (!stored.available) return null;
  return (stored.draws || []).map(normalizeDraw).find((draw) => draw && draw.month === month) || null;
}

export async function sendResend({ to, subject, text, fetchImpl = fetch } = {}) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.EMAIL_FROM || "").trim();
  if (!from) {
    const error = new Error("sender is not set");
    error.code = "SENDER_NOT_SET";
    throw error;
  }
  if (!key) {
    const error = new Error("mail provider key is not set");
    error.code = "MAIL_KEY_NOT_SET";
    throw error;
  }
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!response.ok) {
    const error = new Error(`mail provider status ${response.status}`);
    error.code = "MAIL_PROVIDER";
    error.status = response.status;
    throw error;
  }
}

async function deliver(job, mode, fetchImpl) {
  const to = mode === "dry" ? normalizeManualEmail(process.env.TEST_EMAIL_TO) : job.address;
  if (!to) {
    const error = new Error("test inbox is not set");
    error.code = "NO_TEST_INBOX";
    throw error;
  }
  const subject = mode === "dry" ? `[TEST] ${job.subject}` : job.subject;
  await sendResend({ to, subject, text: job.text, fetchImpl });
}

export async function settleDrawMail({ record, members, now = new Date(), fetchImpl } = {}) {
  if (!drawWritesAllowed()) return { mode: mailMode(), skipped: "deployment" };
  const mode = mailMode();
  const month = String(record?.month || "");
  if (!month) return { mode, skipped: "no-draw" };
  if (mode === "off") return { mode, skipped: "disabled" };

  const fresh = (await readDraw(month)) || record;
  const jobs = buildJobs(fresh, personFor(fresh, members));

  if (mode === "dry" && !normalizeManualEmail(process.env.TEST_EMAIL_TO)) {
    noteOnce(`dry:${month}`, `AWCA draw mail dry run not sent: TEST_EMAIL_TO is unset. month=${month}`);
    return { mode, skipped: "no-test-inbox" };
  }
  if (mode === "live") {
    const from = String(process.env.EMAIL_FROM || "").trim();
    const providerKey = String(process.env.RESEND_API_KEY || "").trim();
    if (!from || !providerKey) {
      noteOnce(`config:${month}`, `AWCA draw mail not sent: mail provider is not configured. month=${month}`);
      return { mode, skipped: "not-configured" };
    }
  }

  let sent = 0;
  for (const job of jobs) {
    if (job.role === "winner" && !job.address) {
      noteOnce(`winner:${month}`, `AWCA draw mail winner has no address. month=${month}`);
      continue;
    }
    const claim = await takeClaim(job, month, mode, now);
    if (!claim.owned) continue;
    try {
      await deliver(job, mode, fetchImpl);
      const saved = await rememberClaim(claim.id, "sent", "");
      if (!saved) {
        console.error(`AWCA draw mail claim was not marked sent: month=${month} role=${job.role}`);
      }
      sent += 1;
    } catch (error) {
      const message = safeMailError(error);
      console.error(`AWCA draw mail failed: month=${month} role=${job.role} reason=${message}`);
      await rememberClaim(claim.id, "failed", message);
      await removeMailClaim(claim.id);
    }
  }
  return { mode, sent };
}
