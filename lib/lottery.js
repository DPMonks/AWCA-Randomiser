import { LotteryError } from "./errors.js";
import { formatUkDate, nextDrawDate, potFor } from "./format.js";
import { activeEntrants, buildMembers, memberDisplayName } from "./entrants.js";
import { pickWinner } from "./draw.js";
import { selectLotteryPlan } from "./plans.js";
import { MOCK_MEMBERS, MOCK_PLAN, isMockMode } from "./mock.js";
import { listDraws, saveDraw } from "./store.js";
import { listOrdersForPlan, listPlans, memberNames } from "./wix.js";

function publicDraw(draw) {
  if (!draw) return null;
  return {
    name: draw.winnerName,
    drawnAt: draw.drawnAt,
    drawnAtLabel: formatUkDate(draw.drawnAt, { withTime: true }),
    entryCount: draw.entryCount,
    pot: draw.potAmount,
    potLabel: `£${Number(draw.potAmount).toFixed(2)}`,
  };
}

function publicMember(member) {
  return {
    name: member.name,
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

export async function getPublicState(extraDraws = []) {
  const { plan, members } = await loadMembers();
  const active = activeEntrants(members);
  const pot = potFor(active.length);
  const draws = mergeDraws(await listDraws(), extraDraws);
  const next = nextDrawDate();
  return {
    mock: isMockMode(),
    planName: plan.name,
    activeEntries: active.length,
    pot,
    potLabel: `£${pot.toFixed(2)}`,
    nextDraw: next.toISOString(),
    nextDrawLabel: formatUkDate(next, { withTime: true }),
    lastWinner: publicDraw(draws[0] || null),
    history: draws.map(publicDraw),
  };
}

export async function getMemberList() {
  const { members } = await loadMembers();
  return {
    mock: isMockMode(),
    members: members.map(publicMember),
  };
}

function mergeDraws(stored, extra) {
  const draws = [...stored];
  const seen = new Set(draws.map((draw) => `${draw.drawnAt}|${draw.winnerName}`));
  for (const draw of extra || []) {
    if (!draw?.winnerName || !draw?.drawnAt) continue;
    const key = `${draw.drawnAt}|${draw.winnerName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    draws.push(draw);
  }
  draws.sort((a, b) => String(b.drawnAt).localeCompare(String(a.drawnAt)));
  return draws.slice(0, 24);
}

export async function runDraw() {
  const { members } = await loadMembers();
  const entrants = activeEntrants(members);
  const winner = pickWinner(entrants);
  if (!winner) {
    throw new LotteryError("There are no active subscribers to draw from.", 409, "NO_ENTRANTS");
  }
  const pot = potFor(entrants.length);
  const draw = {
    winnerName: winner.name,
    winnerMemberId: winner.memberId,
    drawnAt: new Date().toISOString(),
    entryCount: entrants.length,
    potAmount: pot,
  };
  await saveDraw(draw);
  console.log(
    `AWCA draw saved: winner=${draw.winnerName} entries=${draw.entryCount} pot=${draw.potAmount}`
  );
  return { mock: isMockMode(), winner: publicDraw(draw), record: draw };
}
