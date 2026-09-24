import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { issueToken, passwordMatches, verifyToken } from "../lib/auth.js";
import { pickWinner } from "../lib/draw.js";
import { activeEntrants, buildMembers } from "../lib/entrants.js";
import { formatUkDate, nextDrawDate, potFor } from "../lib/format.js";
import { getPublicState, runDraw } from "../lib/lottery.js";
import { selectLotteryPlan } from "../lib/plans.js";

const savedEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}

test("next draw is 20:00 UK time on the 1st", () => {
  const before = nextDrawDate(new Date("2026-09-01T18:59:00.000Z"));
  assert.equal(formatUkDate(before, { withTime: true }), "1 September 2026, 20:00 UK time");

  const onTheHour = nextDrawDate(new Date("2026-09-01T19:00:00.000Z"));
  assert.equal(formatUkDate(onTheHour, { withTime: true }), "1 October 2026, 20:00 UK time");

  const later = nextDrawDate(new Date("2026-09-24T08:00:00.000Z"));
  assert.equal(formatUkDate(later, { withTime: true }), "1 October 2026, 20:00 UK time");
});

test("pot is 1.25 per active entry", () => {
  assert.equal(potFor(0), 0);
  assert.equal(potFor(4), 5);
  assert.equal(potFor(3), 3.75);
});

test("plan selection prefers the configured id, then price, then name", () => {
  const plans = [
    {
      id: "other",
      name: "Newsletter",
      currency: "GBP",
      pricingVariants: [{ pricingStrategies: [{ flatRate: { amount: "5.00" } }] }],
    },
    {
      id: "priced",
      name: "Community",
      currency: "GBP",
      pricingVariants: [{ pricingStrategies: [{ flatRate: { amount: "2.50" } }] }],
    },
    {
      id: "named",
      name: "Lottery extra",
      currency: "GBP",
      pricingVariants: [{ pricingStrategies: [{ flatRate: { amount: "10.00" } }] }],
    },
  ];

  assert.equal(selectLotteryPlan(plans, "named").matchedBy, "WIX_LOTTERY_PLAN_ID");
  assert.equal(selectLotteryPlan(plans, "missing-id").id, "missing-id");
  assert.equal(selectLotteryPlan(plans, "").id, "priced");
  assert.equal(selectLotteryPlan(plans, "").matchedBy, "price 2.50 GBP");

  const onlyNamed = plans.filter((plan) => plan.id !== "priced");
  assert.equal(selectLotteryPlan(onlyNamed, "").matchedBy, "name contains lottery");

  const legacy = [{ id: "old", name: "Old", pricing: { price: { value: "2.50", currency: "GBP" } } }];
  assert.equal(selectLotteryPlan(legacy, "").id, "old");
  assert.equal(selectLotteryPlan([], ""), null);
});

test("members collapse to one row and only active rows are drawn", () => {
  const orders = [
    {
      status: "CANCELED",
      buyer: { memberId: "ada" },
      startDate: "2026-01-01T00:00:00.000Z",
      cancellation: { requestedDate: "2026-02-01T00:00:00.000Z" },
      updatedDate: "2026-02-01T00:00:00.000Z",
    },
    {
      status: "ACTIVE",
      buyer: { memberId: "ada" },
      startDate: "2026-03-01T00:00:00.000Z",
      updatedDate: "2026-03-01T00:00:00.000Z",
    },
    {
      status: "ENDED",
      buyer: { memberId: "ben" },
      startDate: "2025-01-01T00:00:00.000Z",
      endDate: "2025-12-01T00:00:00.000Z",
      updatedDate: "2025-12-01T00:00:00.000Z",
    },
  ];
  const names = new Map([
    ["ada", "Ada Example"],
    ["ben", "Ben Example"],
  ]);
  const members = buildMembers(orders, names);
  assert.equal(members.length, 2);
  assert.equal(members[0].name, "Ada Example");
  assert.equal(members[0].active, true);
  assert.equal(members[0].status, "Active");
  assert.equal(members[1].status, "Ended");
  const entrants = activeEntrants(members);
  assert.deepEqual(entrants.map((member) => member.memberId), ["ada"]);
  assert.equal(pickWinner(entrants, () => 0).name, "Ada Example");
  assert.equal(pickWinner([], () => 0), null);
});

test("mock mode serves sample members without Wix credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awca-"));
  process.env.WIX_MOCK = "1";
  process.env.MOCK_DRAW_FILE = join(dir, "draws.json");
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  try {
    const state = await getPublicState();
    assert.equal(state.mock, true);
    assert.equal(state.activeEntries, 4);
    assert.equal(state.pot, 5);
    assert.equal(state.lastWinner.name, "Sample Winner Sam");
    assert.equal(state.planName, "Sample Lottery Plan");

    const drawn = await runDraw();
    assert.match(drawn.winner.name, /^Sample Member /);
    const again = await getPublicState();
    assert.equal(again.lastWinner.name, drawn.winner.name);
    assert.equal(again.history[1].name, "Sample Winner Sam");
  } finally {
    restoreEnv();
  }
});

test("missing Wix credentials return a clear error", async () => {
  delete process.env.WIX_MOCK;
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  try {
    await assert.rejects(getPublicState(), /WIX_API_KEY and WIX_SITE_ID/);
  } finally {
    restoreEnv();
  }
});

test("admin token accepts the right password only", () => {
  assert.equal(passwordMatches("secret", "secret"), true);
  assert.equal(passwordMatches("nope", "secret"), false);
  const token = issueToken("secret", 1_000);
  assert.equal(verifyToken(token, "secret", 1_000 + 1000), true);
  assert.equal(verifyToken(token, "other", 1_000 + 1000), false);
  assert.equal(verifyToken(token, "secret", 1_000 + 13 * 60 * 60 * 1000), false);
});

test("source files do not contain em or en dashes", async () => {
  const banned = ["\u2013", "\u2014", "\u2011"];
  const skipDirs = new Set([".git", "node_modules"]);
  const root = new URL("..", import.meta.url).pathname;

  async function walk(dir) {
    const entries = await readdir(dir);
    for (const name of entries) {
      if (skipDirs.has(name)) continue;
      const path = join(dir, name);
      const info = await stat(path);
      if (info.isDirectory()) {
        await walk(path);
        continue;
      }
      if (/\.(jpg|jpeg|png|gif|webp)$/i.test(name)) continue;
      const text = await readFile(path, "utf8");
      for (const mark of banned) {
        assert.equal(text.includes(mark), false, `${path} contains a banned dash`);
      }
    }
  }

  await walk(root);
});
