import { LotteryError } from "./errors.js";
import { formatUkDate, isDrawDue, londonMonthKey, monthDrawInstant, nextDrawDate, potFor } from "./format.js";
import { activeEntrants, buildMembers, memberDisplayName } from "./entrants.js";
import { pickWinner } from "./draw.js";
import { selectLotteryPlan } from "./plans.js";
import { MOCK_KNOWN_NAMES, MOCK_MEMBERS, MOCK_PLAN, isMockMode } from "./mock.js";
import {
  entryReference,
  initialsFromName,
  normalizeDraw,
  publicWinnerLabel,
} from "./privacy.js";
import { HISTORY_UNAVAILABLE_MESSAGE, insertIfAbsent, listDraws } from "./store.js";
import { listOrdersForPlan, listPlans, memberNames } from "./wix.js";

function publicDraw(draw) {
  if (!draw) return null;
  return {
    label: publicWinnerLabel(draw),
    initials: draw.initials || "",
    entryRef: draw.entryRef || "",
    drawnAt: draw.drawnAt,
    drawnAtLabel: formatUkDate(draw.drawnAt, { withTime: true }),
    month: draw.month || "",
    entryCount: draw.entryCount,
    pot: draw.potAmount,
    potLabel: `£${Number(draw.potAmount).toFixed(2)}`,
  };
}

function adminMember(member) {
  return {
    name: member.name,
    entryRef: entryReference(member.memberId),
    status: member.status,
    active: member.active,
    startDate: member.startDate,
    startLabel: formatUkDate(member.startDate),
    endDate: member.endDate,
    endLabel: formatUkDate(member.endDate),
  };
}

async function loadLiveMembers() {
  const plans = await listPlans();
  const plan = selectLotteryPlan(plans, process.env.WIX_LOTTERY_PLAN_ID);
  if (!plan) {
    throw new LotteryError(
      "No lottery plan was found. Set WIX_LOTTERY_PLAN_ID, or add a plan priced 2.50 GBP whose name contains lottery.",
      502,
      "PLAN_NOT_FOUND"
    );
  }
  if (plan.missingFromList) {
    console.warn(
      `AWCA lottery plan id ${plan.id} was not returned by the plans query. Using the configured id anyway.`
    );
  }
  if (plan.ambiguous) {
    console.warn(
      `AWCA lottery plan match was ambiguous. Using id=${plan.id} name=${plan.name} via ${plan.matchedBy}. Set WIX_LOTTERY_PLAN_ID to pin one plan.`
    );
  }
  console.log(`AWCA lottery plan selected: id=${plan.id} name=${plan.name} via ${plan.matchedBy}`);

  const orders = await listOrdersForPlan(plan.id);
  const ids = orders.map((order) => order.buyer?.memberId).filter(Boolean);
  const rawMembers = await memberNames(ids);
  const names = new Map();
  for (const [id, member] of rawMembers) {
    names.set(id, memberDisplayName(member));
  }
  return { plan, members: buildMembers(orders, names) };
}

async function loadMembers() {
  if (isMockMode()) {
    console.log(
      `AWCA lottery plan selected: id=${MOCK_PLAN.id} name=${MOCK_PLAN.name} via ${MOCK_PLAN.matchedBy}`
    );
    return { plan: MOCK_PLAN, members: MOCK_MEMBERS.map((member) => ({ ...member })) };
  }
  return loadLiveMembers();
}

function mergeDraws(stored, extra) {
  const draws = (stored || []).map(normalizeDraw).filter(Boolean);
  const seen = new Set(draws.map((draw) => `${draw.drawnAt}|${draw.memberId}|${draw.entryRef}`));
  for (const raw of extra || []) {
    const draw = normalizeDraw(raw);
    if (!draw?.drawnAt || (!draw.entryRef && !draw.memberId && !draw.initials)) continue;
    const key = `${draw.drawnAt}|${draw.memberId}|${draw.entryRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    draws.push(draw);
  }
  draws.sort((a, b) => String(b.drawnAt).localeCompare(String(a.drawnAt)));
  return draws.slice(0, 24);
}

function historyFields(stored) {
  return {
    historyAvailable: stored.available,
    historyMessage: stored.available ? "" : HISTORY_UNAVAILABLE_MESSAGE,
  };
}

function publicEntryRefs(members) {
  try {
    return members.map((member) => entryReference(member.memberId)).filter(Boolean).sort();
  } catch (error) {
    if (error?.code === "MISSING_ENTRY_SECRET") return [];
    throw error;
  }
}

function drawForMonth(draws, month) {
  return (draws || []).map(normalizeDraw).find((draw) => draw && draw.month === month) || null;
}

export async function ensureMonthlyDraw({ now = new Date(), force = false } = {}) {
  const month = londonMonthKey(now);
  if (!force && !isDrawDue(now)) {
    return { status: "not-due", created: false, month, record: null };
  }

  const stored = await listDraws();
  if (!stored.available) {
    console.error(`AWCA automatic draw skipped: ${HISTORY_UNAVAILABLE_MESSAGE}`);
    throw new LotteryError(HISTORY_UNAVAILABLE_MESSAGE, 503, "HISTORY_UNAVAILABLE");
  }

  const existing = drawForMonth(stored.draws, month);
  if (existing) {
    return { status: "exists", created: false, month, record: existing };
  }

  const { members } = await loadMembers();
  const entrants = activeEntrants(members);
  const winner = pickWinner(entrants);
  if (!winner) {
    throw new LotteryError("There are no active subscribers to draw from.", 409, "NO_ENTRANTS");
  }

  const record = normalizeDraw({
    memberId: winner.memberId,
    initials: initialsFromName(winner.name),
    entryRef: entryReference(winner.memberId),
    month,
    drawnAt: now.toISOString(),
    entryCount: entrants.length,
    potAmount: potFor(entrants.length),
  });

  let saved;
  try {
    saved = await insertIfAbsent(record);
  } catch (error) {
    if (error?.code === "HISTORY_UNAVAILABLE") {
      console.error(`AWCA automatic draw skipped: ${error.message}`);
    }
    throw error;
  }

  if (saved.created) {
    console.log(
      `AWCA draw saved: month=${saved.record.month} entry=${saved.record.entryRef} entries=${saved.record.entryCount} pot=${saved.record.potAmount}`
    );
  }
  return {
    status: saved.created ? "created" : "exists",
    created: saved.created,
    month,
    record: saved.record,
  };
}

export async function getPublicState(extraDraws = [], now = new Date()) {
  const { plan, members } = await loadMembers();
  const active = activeEntrants(members);
  const pot = potFor(active.length);
  const month = londonMonthKey(now);
  let stored = await listDraws();
  if (stored.available && isDrawDue(now) && !drawForMonth(stored.draws, month)) {
    try {
      await ensureMonthlyDraw({ now, force: false });
      stored = await listDraws();
    } catch (error) {
      if (error?.code !== "HISTORY_UNAVAILABLE" && error?.code !== "NO_ENTRANTS") throw error;
      console.error(`AWCA automatic draw skipped: ${error.message}`);
    }
  }
  const draws = stored.available ? mergeDraws(stored.draws, extraDraws) : [];
  const drawnThisMonth = Boolean(drawForMonth(draws, month));
  const drawDue = stored.available && isDrawDue(now) && !drawnThisMonth;
  const next = drawDue ? monthDrawInstant(now) : nextDrawDate(now);
  return {
    mock: isMockMode(),
    planName: plan.name,
    activeEntries: active.length,
    pot,
    potLabel: `£${pot.toFixed(2)}`,
    nextDraw: next.toISOString(),
    nextDrawLabel: formatUkDate(next, { withTime: true }),
    drawDue,
    drawMonth: month,
    ...historyFields(stored),
    entryRefs: publicEntryRefs(active),
    lastWinner: stored.available ? publicDraw(draws[0] || null) : null,
    history: stored.available ? draws.map(publicDraw) : [],
  };
}

export async function getMemberList() {
  const { members } = await loadMembers();
  const stored = await listDraws();
  return {
    mock: isMockMode(),
    ...historyFields(stored),
    members: members.map(adminMember),
  };
}

async function namesForDraws(draws, members) {
  const names = new Map();
  for (const member of members) names.set(member.memberId, member.name);
  if (isMockMode()) {
    for (const [id, name] of Object.entries(MOCK_KNOWN_NAMES)) {
      if (!names.has(id)) names.set(id, name);
    }
    return names;
  }
  const missing = [...new Set(draws.map((draw) => draw.memberId).filter((id) => id && !names.has(id)))];
  if (missing.length === 0) return names;
  const raw = await memberNames(missing);
  for (const [id, member] of raw) names.set(id, memberDisplayName(member));
  return names;
}

export async function getAdminDraws(extraDraws = []) {
  const { members } = await loadMembers();
  const stored = await listDraws();
  const draws = stored.available ? mergeDraws(stored.draws, extraDraws) : [];
  const names = stored.available ? await namesForDraws(draws, members) : new Map();
  return {
    mock: isMockMode(),
    ...historyFields(stored),
    draws: draws.map((draw) => ({
      ...publicDraw(draw),
      fullName: names.get(draw.memberId) || "",
    })),
  };
}

export async function runDraw(now = new Date()) {
  const result = await ensureMonthlyDraw({ now, force: true });
  const record = result.record;
  const { members } = await loadMembers();
  const names = await namesForDraws([record], members);
  return {
    mock: isMockMode(),
    alreadyDrawn: !result.created,
    winner: { ...publicDraw(record), fullName: names.get(record.memberId) || "" },
    record,
  };
}
