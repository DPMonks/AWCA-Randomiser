import { createHash, randomBytes } from "node:crypto";
import { drawWritesAllowed } from "./draw-guard.js";
import { monthKeyLabel } from "./format.js";
import { normalizeManualEmail } from "./manual-entrants.js";
import { entryNumberFromRef, initialsFromName, normalizeDraw } from "./privacy.js";
import { compareAndSwapMail, listDraws } from "./store.js";

export const DEFAULT_NOTIFY_COPIES = [
  "secretary@alconbury-weald.org",
  "community-association@alconbury-weald.org",
];

const LOCK_MS = 2 * 60 * 1000;
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

function blankState(raw = "") {
  return { raw: String(raw || ""), lock: "", lockAt: "", sent: [], errors: [] };
}

function parseState(raw) {
  const text = String(raw || "");
  if (!text) return blankState("");
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return blankState(text);
    return {
      raw: text,
      lock: String(data.lock || ""),
      lockAt: String(data.lockAt || ""),
      sent: Array.isArray(data.sent) ? data.sent.filter(validSent) : [],
      errors: Array.isArray(data.errors) ? data.errors.filter(validError) : [],
    };
  } catch {
    return blankState(text);
  }
}

function validSent(row) {
  return Boolean(
    row &&
      (row.role === "winner" || row.role === "copy") &&
      /^[0-9a-f]{16}$/.test(String(row.key || "")) &&
      (row.mode === "live" || row.mode === "dry") &&
      /^\d{4}-\d{2}-\d{2}T/.test(String(row.at || ""))
  );
}

function validError(row) {
  const message = String(row?.message || "");
  return Boolean(
    row &&
      (row.role === "winner" || row.role === "copy") &&
      (!row.key || /^[0-9a-f]{16}$/.test(String(row.key))) &&
      message &&
      message.length < 80 &&
      !message.includes("@") &&
      !/email/i.test(message)
  );
}

function serialize(state, lock, lockAt) {
  return JSON.stringify({
    v: 1,
    lock: lock || "",
    lockAt: lockAt || "",
    sent: state.sent.map((row) => ({ role: row.role, key: row.key, at: row.at, mode: row.mode })),
    errors: state.errors.map((row) => ({ role: row.role, key: row.key || "", message: row.message })),
  });
}

function isSent(state, job, mode) {
  if (!job.key) return false;
  return state.sent.some((row) => row.role === job.role && row.key === job.key && row.mode === mode);
}

function hasError(state, job, message) {
  return state.errors.some((row) => row.role === job.role && (row.key || "") === (job.key || "") && row.message === message);
}

function jobDone(state, job, mode) {
  if (job.role === "winner" && !job.address) return hasError(state, job, "winner address unavailable");
  return isSent(state, job, mode);
}

function lockFresh(state, now) {
  if (!state.lock || !state.lockAt) return false;
  const at = Date.parse(state.lockAt);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at < LOCK_MS;
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

async function persist(month, state, lock, lockAt) {
  const next = serialize(state, lock, lockAt);
  const ok = await compareAndSwapMail(month, state.raw, next);
  if (!ok) return null;
  const parsed = parseState(next);
  parsed.raw = next;
  return parsed;
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
  let state = parseState(fresh.mailStatus || "");
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

  if (jobs.every((job) => jobDone(state, job, mode))) return { mode, skipped: "done", sent: 0 };
  if (lockFresh(state, now)) return { mode, skipped: "busy" };

  const token = randomBytes(8).toString("hex");
  const claimed = await persist(month, state, token, now.toISOString());
  if (!claimed) return { mode, skipped: "busy" };
  state = claimed;

  let sent = 0;
  for (const job of jobs) {
    if (jobDone(state, job, mode)) continue;
    if (job.role === "winner" && !job.address) {
      if (!hasError(state, job, "winner address unavailable")) {
        state.errors = [
          ...state.errors.filter((row) => !(row.role === job.role && (row.key || "") === "")),
          { role: "winner", key: "", message: "winner address unavailable" },
        ];
        const saved = await persist(month, state, token, new Date().toISOString());
        if (!saved) return { mode, sent, incomplete: true };
        state = saved;
      }
      continue;
    }
    try {
      await deliver(job, mode, fetchImpl);
      state.sent = [
        ...state.sent.filter((row) => !(row.role === job.role && row.key === job.key && row.mode === mode)),
        { role: job.role, key: job.key, at: new Date().toISOString(), mode },
      ];
      state.errors = state.errors.filter((row) => !(row.role === job.role && (row.key || "") === job.key));
      sent += 1;
    } catch (error) {
      const message = safeMailError(error);
      console.error(`AWCA draw mail failed: month=${month} role=${job.role} reason=${message}`);
      state.errors = [
        ...state.errors.filter((row) => !(row.role === job.role && (row.key || "") === job.key)),
        { role: job.role, key: job.key || "", message },
      ];
    }
    const saved = await persist(month, state, token, new Date().toISOString());
    if (!saved) {
      console.error(`AWCA draw mail status was not saved: month=${month} role=${job.role}`);
      return { mode, sent, incomplete: true };
    }
    state = saved;
  }

  const cleared = await persist(month, state, "", "");
  return { mode, sent, skipped: cleared ? "" : "lock-left" };
}
