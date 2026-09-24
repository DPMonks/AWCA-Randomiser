import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { issueToken, passwordMatches, verifyToken } from "../lib/auth.js";
import { pickWinner } from "../lib/draw.js";
import { activeEntrants, buildMembers } from "../lib/entrants.js";
import { formatUkDate, nextDrawDate, potFor } from "../lib/format.js";
import { getAdminDraws, getMemberList, getPublicState, runDraw } from "../lib/lottery.js";
import { HISTORY_UNAVAILABLE_MESSAGE } from "../lib/store.js";
import { selectLotteryPlan } from "../lib/plans.js";
import { entryReference, initialsFromName, publicWinnerLabel } from "../lib/privacy.js";
import { drawCollectionSpec, toDrawRecord } from "../lib/wix.js";

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

const PRIVATE_NAMES = [
  "Sample Winner Sam",
  "Sample Member Ada",
  "Sample Member Ben",
  "Sample Member Cleo",
  "Sample Member Drew",
  "Sample Member Erin",
  "Sample Member Fran",
  "Sample Member Cookie",
  "Daniel Monks",
];

function assertNoPrivateNames(value) {
  const json = JSON.stringify(value);
  for (const name of PRIVATE_NAMES) {
    assert.equal(json.includes(name), false, `public payload contains ${name}`);
  }
  assert.equal(json.includes("winnerName"), false);
  assert.equal(json.includes("fullName"), false);
  assert.equal(json.includes("memberId"), false);
  assert.equal(json.includes("@"), false);
}

function assertPublicWinner(draw) {
  assert.equal("name" in draw, false);
  assert.equal("fullName" in draw, false);
  assert.equal("memberId" in draw, false);
  assert.match(draw.entryRef, /^[0-9A-F]{6}$/);
  assert.match(draw.label, / - Entry [0-9A-F]{6}$/);
}

test("initials use the first and last name, and hyphenated parts", () => {
  assert.equal(initialsFromName("Daniel Monks"), "D.M.");
  assert.equal(initialsFromName("  Daniel   Monks  "), "D.M.");
  assert.equal(initialsFromName("Sam"), "S.");
  assert.equal(initialsFromName("Mary-Jane Watson"), "M.J.W.");
  assert.equal(initialsFromName("Daniel Monks-Smith"), "D.M.S.");
  assert.equal(initialsFromName("Mary-Jane"), "M.J.");
  assert.equal(initialsFromName("Jean Luc Picard"), "J.P.");
  assert.equal(initialsFromName("Anne-Marie Claire-Jones"), "A.M.C.J.");
  assert.equal(initialsFromName(""), "");
  assert.equal(initialsFromName("   "), "");
  assert.equal(initialsFromName("Member"), "");
  assert.equal(initialsFromName("member"), "");
  assert.equal(publicWinnerLabel({ initials: "D.M.", entryRef: "4F7A2C" }), "D.M. - Entry 4F7A2C");
  assert.equal(publicWinnerLabel({ initials: "", entryRef: "4F7A2C" }), "Entry 4F7A2C");
  assert.equal(publicWinnerLabel({ initials: "Daniel Monks", entryRef: "4F7A2C" }), "Entry 4F7A2C");
});

test("entry reference is a stable HMAC prefix of the member id", () => {
  process.env.ENTRY_REF_SECRET = "committee-secret";
  delete process.env.ADMIN_PASSWORD;
  delete process.env.WIX_MOCK;
  try {
    const first = entryReference("wix-member-1");
    const expected = createHmac("sha256", "committee-secret")
      .update("wix-member-1")
      .digest("hex")
      .slice(0, 6)
      .toUpperCase();
    assert.equal(first, expected);
    assert.equal(entryReference("wix-member-1"), first);
    assert.notEqual(entryReference("wix-member-2"), first);
    assert.equal(first.includes("wix-member-1"), false);

    process.env.ENTRY_REF_SECRET = "other-secret";
    assert.notEqual(entryReference("wix-member-1"), first);

    delete process.env.ENTRY_REF_SECRET;
    process.env.ADMIN_PASSWORD = "admin-pass";
    const fromAdmin = createHmac("sha256", "admin-pass")
      .update("wix-member-1")
      .digest("hex")
      .slice(0, 6)
      .toUpperCase();
    assert.equal(entryReference("wix-member-1"), fromAdmin);

    delete process.env.ADMIN_PASSWORD;
    process.env.WIX_MOCK = "1";
    const fromMock = createHmac("sha256", "awca-mock-entry-ref")
      .update("wix-member-1")
      .digest("hex")
      .slice(0, 6)
      .toUpperCase();
    assert.equal(entryReference("wix-member-1"), fromMock);

    delete process.env.WIX_MOCK;
    assert.throws(() => entryReference("wix-member-1"), /ENTRY_REF_SECRET/);
  } finally {
    restoreEnv();
  }
});

test("draw storage keeps initials and an entry reference, not the full name", () => {
  process.env.ENTRY_REF_SECRET = "committee-secret";
  try {
    const record = toDrawRecord({
      data: {
        winnerName: "Daniel Monks",
        winnerMemberId: "member-1",
        drawnAt: "2026-08-01T19:00:00.000Z",
        entryCount: 4,
        potAmount: 5,
      },
    });
    assert.equal(record.initials, "D.M.");
    assert.equal(record.memberId, "member-1");
    assert.equal(record.month, "2026-08");
    assert.equal(record.entryRef, entryReference("member-1"));
    assert.equal("winnerName" in record, false);
    assert.equal(JSON.stringify(record).includes("Daniel Monks"), false);

    const spec = drawCollectionSpec();
    assert.equal(spec.permissions.read, "ADMIN");
    assert.equal(spec.permissions.insert, "ADMIN");
    assert.equal(spec.permissions.update, "ADMIN");
    assert.equal(spec.permissions.remove, "ADMIN");
    assert.equal(spec.fields.some((field) => field.key === "winnerName"), false);
    assert.deepEqual(
      spec.fields.map((field) => field.key),
      ["memberId", "initials", "entryRef", "month", "drawnAt", "entryCount", "potAmount"]
    );
  } finally {
    restoreEnv();
  }
});

test("mock mode serves sample members without Wix credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awca-"));
  process.env.WIX_MOCK = "1";
  process.env.MOCK_DRAW_FILE = join(dir, "draws.json");
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  delete process.env.ENTRY_REF_SECRET;
  delete process.env.ADMIN_PASSWORD;
  try {
    const state = await getPublicState();
    assert.equal(state.mock, true);
    assert.equal(state.activeEntries, 4);
    assert.equal(state.pot, 5);
    assert.equal(state.planName, "Sample Lottery Plan");
    assertPublicWinner(state.lastWinner);
    assert.match(state.lastWinner.label, /^S\.S\. - Entry [0-9A-F]{6}$/);
    assert.equal(state.entryRefs.length, state.activeEntries);
    assert.deepEqual(
      [...state.entryRefs].sort(),
      ["mock-ada", "mock-ben", "mock-cleo", "mock-drew"].map((id) => entryReference(id)).sort()
    );
    for (const ref of state.entryRefs) assert.match(ref, /^[0-9A-F]{6}$/);
    assert.equal(JSON.stringify(state.entryRefs).includes("Sample"), false);
    assert.equal(JSON.stringify(state.entryRefs).includes("."), false);
    assertNoPrivateNames(state);

    const drawn = await runDraw();
    assert.match(drawn.winner.fullName, /^Sample Member /);
    assert.match(drawn.winner.label, /^[A-Z](?:\.[A-Z])*\. - Entry [0-9A-F]{6}$/);
    assert.equal(drawn.winner.entryRef, entryReference(drawn.record.memberId));
    assert.equal("name" in drawn.winner, false);
    assert.equal(drawn.record.initials, initialsFromName(drawn.winner.fullName));
    assert.equal("winnerName" in drawn.record, false);
    assert.equal(JSON.stringify(drawn.record).includes(drawn.winner.fullName), false);

    const again = await getPublicState();
    assert.equal(again.lastWinner.label, drawn.winner.label);
    assert.equal(again.lastWinner.entryRef, drawn.winner.entryRef);
    assert.match(again.history[1].label, /^S\.S\. - Entry [0-9A-F]{6}$/);
    assertNoPrivateNames(again);
    assert.equal(JSON.stringify(again).includes(drawn.winner.fullName), false);

    const members = await getMemberList();
    assert.equal(members.members[0].name, "Sample Member Ada");
    assert.equal(members.members[0].entryRef, entryReference("mock-ada"));
    assert.equal("memberId" in members.members[0], false);

    const adminDraws = await getAdminDraws();
    assert.equal(adminDraws.draws.some((draw) => draw.fullName === "Sample Winner Sam"), true);
    assert.equal(
      adminDraws.draws.find((draw) => draw.fullName === drawn.winner.fullName)?.label,
      drawn.winner.label
    );

    const fromCookie = await getPublicState([
      {
        winnerName: "Sample Member Cookie",
        winnerMemberId: "mock-cookie",
        drawnAt: "2099-01-01T12:00:00.000Z",
        entryCount: 4,
        potAmount: 5,
      },
    ]);
    assert.match(fromCookie.lastWinner.label, /^S\.C\. - Entry [0-9A-F]{6}$/);
    assertNoPrivateNames(fromCookie);
  } finally {
    restoreEnv();
  }
});

test("WDE0110 leaves live entries available and refuses the draw", async () => {
  delete process.env.WIX_MOCK;
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "site";
  process.env.WIX_LOTTERY_PLAN_ID = "6c181c0f-8ed4-43f9-adea-15aee44998f6";
  process.env.ENTRY_REF_SECRET = "committee-secret";
  process.env.ADMIN_PASSWORD = "committee-secret";
  const originalFetch = globalThis.fetch;
  const dataCalls = [];

  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (path.includes("/pricing-plans/v3/plans/query")) {
      return json({
        plans: [
          {
            id: "6c181c0f-8ed4-43f9-adea-15aee44998f6",
            name: "Community Lottery",
            currency: "GBP",
            pricingVariants: [{ pricingStrategies: [{ flatRate: { amount: "2.50" } }] }],
          },
        ],
      });
    }
    if (path.includes("/pricing-plans/v2/orders")) {
      return json({
        orders: [
          {
            status: "ACTIVE",
            buyer: { memberId: "member-1" },
            startDate: "2026-01-05T10:00:00.000Z",
            updatedDate: "2026-01-05T10:00:00.000Z",
          },
        ],
        pagingMetadata: { total: 1, hasNext: false },
      });
    }
    if (path.includes("/members/v1/members/query")) {
      return json({
        members: [
          {
            id: "member-1",
            contact: { firstName: "Daniel", lastName: "Monks" },
          },
        ],
      });
    }
    if (path.includes("/wix-data/")) {
      dataCalls.push({ path, method: options.method || "GET" });
      return json(
        {
          message:
            "WDE0110: Wix CMS app is not installed for site (appId: e593b0bd-b783-45b8-97c2-873d42aacaf4).",
        },
        400
      );
    }
    throw new Error(`Unexpected Wix call ${path}`);
  };

  try {
    const state = await getPublicState();
    assert.equal(state.historyAvailable, false);
    assert.equal(state.historyMessage, HISTORY_UNAVAILABLE_MESSAGE);
    assert.equal(state.lastWinner, null);
    assert.deepEqual(state.history, []);
    assert.equal(state.activeEntries, 1);
    assert.equal(state.pot, 1.25);
    assert.equal(state.potLabel, "£1.25");
    assert.match(state.nextDrawLabel, /20:00 UK time$/);
    assert.equal(state.entryRefs.length, 1);
    assert.match(state.entryRefs[0], /^[0-9A-F]{6}$/);
    assert.equal(JSON.stringify(state).includes("Daniel Monks"), false);
    assert.equal(JSON.stringify(state.entryRefs).includes("Daniel"), false);

    const members = await getMemberList();
    assert.equal(members.historyAvailable, false);
    assert.equal(members.members.length, 1);
    assert.equal(members.members[0].name, "Daniel Monks");
    assert.match(members.members[0].entryRef, /^[0-9A-F]{6}$/);

    const adminDraws = await getAdminDraws();
    assert.equal(adminDraws.historyAvailable, false);
    assert.deepEqual(adminDraws.draws, []);

    await assert.rejects(runDraw(), new RegExp(HISTORY_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(
      dataCalls.some((call) => /\/wix-data\/v2\/items$/.test(call.path)),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
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
