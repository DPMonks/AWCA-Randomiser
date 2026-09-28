import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import cronDraw from "../api/cron/draw.js";
import winnersApi from "../api/winners.js";
import { issueToken, passwordMatches, requireCron, verifyToken } from "../lib/auth.js";
import { pickWinner } from "../lib/draw.js";
import { activeEntrants, buildMembers } from "../lib/entrants.js";
import { drawFingerprint, hashEntrantRefs, sortedEntryRefs } from "../lib/fairness.js";
import { formatUkDate, isDrawDue, londonMonthKey, monthDrawInstant, nextDrawDate, potFor } from "../lib/format.js";
import { ensureMonthlyDraw, getAdminDraws, getMemberList, getPublicState, getPublicWinners, runDraw } from "../lib/lottery.js";
import { CMS_NOT_INSTALLED_MESSAGE, HISTORY_UNAVAILABLE_MESSAGE, historyUnavailableMessage } from "../lib/store.js";
import { selectLotteryPlan } from "../lib/plans.js";
import { entryReference, initialsFromName, publicWinnerLabel } from "../lib/privacy.js";
import { drawCollectionSpec, insertDrawIfAbsent, toDrawRecord } from "../lib/wix.js";

const savedEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}

test("draw is due at 20:00 UK time in summer and winter", () => {
  const summer = new Date("2026-10-01T19:00:00.000Z");
  const summerEarly = new Date("2026-10-01T18:59:00.000Z");
  assert.equal(londonMonthKey(summer), "2026-10");
  assert.equal(isDrawDue(summer), true);
  assert.equal(isDrawDue(summerEarly), false);
  assert.equal(formatUkDate(monthDrawInstant(summer), { withTime: true }), "1 October 2026, 20:00 UK time");

  const winter = new Date("2026-12-01T20:00:00.000Z");
  const winterEarly = new Date("2026-12-01T19:59:00.000Z");
  const winterNineteenUtc = new Date("2026-12-01T19:00:00.000Z");
  assert.equal(londonMonthKey(winter), "2026-12");
  assert.equal(isDrawDue(winter), true);
  assert.equal(isDrawDue(winterEarly), false);
  assert.equal(isDrawDue(winterNineteenUtc), false);
  assert.equal(formatUkDate(monthDrawInstant(winter), { withTime: true }), "1 December 2026, 20:00 UK time");
});

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
      ["memberId", "initials", "entryRef", "month", "drawnAt", "entryCount", "potAmount", "fingerprint", "entrantsHash", "winnerIndex"]
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
    const state = await getPublicState([], new Date("2026-09-01T12:00:00.000Z"));
    assert.equal(state.mock, true);
    assert.equal(state.drawDue, false);
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

    const drawAt = new Date("2026-09-24T08:00:00.000Z");
    const drawn = await runDraw(drawAt);
    assert.match(drawn.winner.fullName, /^Sample Member /);
    assert.match(drawn.winner.label, /^[A-Z](?:\.[A-Z])*\. - Entry [0-9A-F]{6}$/);
    assert.equal(drawn.winner.entryRef, entryReference(drawn.record.memberId));
    assert.equal("name" in drawn.winner, false);
    assert.equal(drawn.record.initials, initialsFromName(drawn.winner.fullName));
    assert.equal("winnerName" in drawn.record, false);
    assert.equal(JSON.stringify(drawn.record).includes(drawn.winner.fullName), false);

    const again = await getPublicState([], drawAt);
    assert.equal(again.drawDue, false);
    const repeat = await runDraw(drawAt);
    assert.equal(repeat.alreadyDrawn, true);
    assert.equal(repeat.winner.entryRef, drawn.winner.entryRef);
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

    const fromCookie = await getPublicState(
      [
        {
          winnerName: "Sample Member Cookie",
          winnerMemberId: "mock-cookie",
          drawnAt: "2099-01-01T12:00:00.000Z",
          entryCount: 4,
          potAmount: 5,
        },
      ],
      drawAt
    );
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
    assert.equal(state.historyMessage, CMS_NOT_INSTALLED_MESSAGE);
    assert.equal(/Wix Editor|Add CMS/i.test(state.historyMessage), false);
    assert.equal(state.lastWinner, null);
    assert.deepEqual(state.history, []);
    assert.equal(state.activeEntries, 1);
    assert.equal(state.pot, 1.25);
    assert.equal(state.potLabel, "£1.25");
    assert.equal(state.drawDue, false);
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

    const winners = await getPublicWinners();
    assert.equal(winners.historyAvailable, false);
    assert.equal(winners.message, CMS_NOT_INSTALLED_MESSAGE);
    assert.deepEqual(winners.winners, []);
    assert.equal(JSON.stringify(winners).includes("Daniel"), false);

    const cmsMessage = new RegExp(CMS_NOT_INSTALLED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    await assert.rejects(runDraw(), cmsMessage);
    await assert.rejects(
      ensureMonthlyDraw({ now: new Date("2026-10-01T19:00:00.000Z"), force: false }),
      cmsMessage
    );
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

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    send(payload) {
      this.body = JSON.parse(payload);
    },
  };
}

test("one draw is saved per month even when requests race", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awca-"));
  process.env.WIX_MOCK = "1";
  process.env.MOCK_DRAW_FILE = join(dir, "draws.json");
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  delete process.env.ENTRY_REF_SECRET;
  delete process.env.ADMIN_PASSWORD;
  try {
    const early = new Date("2026-10-01T18:59:00.000Z");
    const before = await getPublicState([], early);
    assert.equal(before.drawDue, false);
    assert.match(before.lastWinner.label, /^S\.S\. - Entry [0-9A-F]{6}$/);
    assert.equal(before.history.some((draw) => draw.month === "2026-10"), false);

    const summer = new Date("2026-10-01T19:00:00.000Z");
    const first = await ensureMonthlyDraw({ now: summer });
    const second = await ensureMonthlyDraw({ now: summer });
    assert.equal(first.created, true);
    assert.equal(first.status, "created");
    assert.equal(second.created, false);
    assert.equal(second.record.entryRef, first.record.entryRef);
    assert.equal(second.record.memberId, first.record.memberId);
    assert.equal(first.record.entryCount, 4);
    assert.equal(first.record.potAmount, 5);
    assert.equal(first.record.month, "2026-10");
    const refs = ["mock-ada", "mock-ben", "mock-cleo", "mock-drew"].map((id) => entryReference(id));
    assert.equal(first.record.winnerIndex, sortedEntryRefs(refs).indexOf(first.record.entryRef));
    assert.equal(
      first.record.fingerprint,
      drawFingerprint({
        month: "2026-10",
        drawnAt: first.record.drawnAt,
        entryRefs: refs,
        winnerIndex: first.record.winnerIndex,
      })
    );
    assert.equal(first.record.entrantsHash, hashEntrantRefs(refs));
    assert.equal(second.record.fingerprint, first.record.fingerprint);

    const after = await getPublicState([], summer);
    assert.equal(after.drawDue, false);
    assert.equal(after.lastWinner.entryRef, first.record.entryRef);
    assert.equal(after.lastWinner.fingerprint, first.record.fingerprint);
    assert.equal(after.history[0].entrantsHash, first.record.entrantsHash);
    assert.equal(JSON.stringify(after).includes("Sample Member"), false);
    assert.equal(JSON.stringify(after).includes("memberId"), false);

    const winter = new Date("2026-12-01T20:00:00.000Z");
    const raced = await Promise.all([
      ensureMonthlyDraw({ now: winter }),
      ensureMonthlyDraw({ now: winter }),
    ]);
    assert.equal(raced[0].record.entryRef, raced[1].record.entryRef);
    assert.equal(raced.filter((result) => result.created).length, 1);

    const skipped = await ensureMonthlyDraw({ now: new Date("2026-12-01T19:00:00.000Z") });
    assert.equal(skipped.status, "not-due");
    assert.equal(skipped.created, false);

    const raw = JSON.parse(await readFile(process.env.MOCK_DRAW_FILE, "utf8"));
    assert.equal(raw.extra.filter((row) => row.month === "2026-10").length, 1);
    assert.equal(raw.extra.filter((row) => row.month === "2026-12").length, 1);
    assert.equal(raw.extra.some((row) => row.month === "2026-11"), false);
  } finally {
    restoreEnv();
  }
});

test("a conflicting insert keeps the winner already saved", async () => {
  delete process.env.WIX_MOCK;
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "site";
  process.env.ENTRY_REF_SECRET = "committee-secret";
  const originalFetch = globalThis.fetch;
  const saved = {
    id: "2026-10",
    data: {
      memberId: "member-saved",
      initials: "S.S.",
      entryRef: "AAAAAA",
      month: "2026-10",
      drawnAt: "2026-10-01T19:00:00.000Z",
      entryCount: 2,
      potAmount: 2.5,
    },
  };
  let inserts = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (path.includes("/wix-data/v2/collections/") && !path.includes("/items")) {
      return json({
        collection: {
          fields: [{ key: "fingerprint" }, { key: "entrantsHash" }, { key: "winnerIndex" }],
        },
      });
    }
    if (path.includes("/wix-data/v2/items/2026-10")) {
      return json({ dataItem: saved });
    }
    if (path.endsWith("/wix-data/v2/items") && options.method === "POST") {
      inserts += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.dataItem.id, "2026-10");
      assert.equal(body.dataItem.data.month, "2026-10");
      return json({ message: "WDE0073: Item already exists" }, 409);
    }
    throw new Error(`Unexpected Wix call ${path}`);
  };
  try {
    const result = await insertDrawIfAbsent({
      memberId: "member-new",
      initials: "N.N.",
      entryRef: "BBBBBB",
      month: "2026-10",
      drawnAt: "2026-10-01T19:00:01.000Z",
      entryCount: 9,
      potAmount: 11.25,
    });
    assert.equal(inserts, 1);
    assert.equal(result.created, false);
    assert.equal(result.record.entryRef, "AAAAAA");
    assert.equal(result.record.memberId, "member-saved");
    assert.equal(result.record.entryCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("cron auth requires the CRON_SECRET bearer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awca-"));
  process.env.WIX_MOCK = "1";
  process.env.MOCK_DRAW_FILE = join(dir, "draws.json");
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  delete process.env.ENTRY_REF_SECRET;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.CRON_SECRET;
  try {
    assert.throws(() => requireCron({ headers: { authorization: "Bearer secret" } }), (error) => error.status === 503);

    const missing = fakeRes();
    await cronDraw({ method: "GET", headers: {} }, missing);
    assert.equal(missing.statusCode, 503);

    process.env.CRON_SECRET = "cron-secret";
    assert.throws(() => requireCron({ headers: { authorization: "Bearer wrong" } }), (error) => error.status === 401);
    assert.throws(() => requireCron({ headers: {} }), (error) => error.status === 401);
    assert.doesNotThrow(() => requireCron({ headers: { authorization: "Bearer cron-secret" } }));

    const wrong = fakeRes();
    await cronDraw({ method: "GET", headers: { authorization: "Bearer wrong" } }, wrong);
    assert.equal(wrong.statusCode, 401);

    const winterEarly = fakeRes();
    await cronDraw(
      {
        method: "GET",
        headers: { authorization: "Bearer cron-secret" },
        drawNow: new Date("2026-12-01T19:00:00.000Z"),
      },
      winterEarly
    );
    assert.equal(winterEarly.statusCode, 200);
    assert.equal(winterEarly.body.skipped, true);
    assert.equal(winterEarly.body.created, false);
    assert.equal(winterEarly.body.reason, "Before 20:00 UK time on the 1st.");

    const summer = fakeRes();
    await cronDraw(
      {
        method: "GET",
        headers: { authorization: "Bearer cron-secret" },
        drawNow: new Date("2026-10-01T19:00:00.000Z"),
      },
      summer
    );
    assert.equal(summer.statusCode, 200);
    assert.equal(summer.body.created, true);
    assert.equal(summer.body.month, "2026-10");
    assert.match(summer.body.entryRef, /^[0-9A-F]{6}$/);
    assert.equal(summer.body.memberId, undefined);
    assert.equal(JSON.stringify(summer.body).includes("Sample"), false);

    const again = fakeRes();
    await cronDraw(
      {
        method: "POST",
        headers: { authorization: "Bearer cron-secret" },
        drawNow: new Date("2026-10-01T19:05:00.000Z"),
      },
      again
    );
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.created, false);
    assert.equal(again.body.entryRef, summer.body.entryRef);
  } finally {
    restoreEnv();
  }
});

test("vercel cron covers summer, winter, and late runs", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(
    config.crons.map((cron) => cron.schedule),
    ["0 19 1 * *", "0 20 1 * *", "0 21 1 * *", "0 22 1 * *"]
  );
  assert.equal(config.crons.every((cron) => cron.path === "/api/cron/draw"), true);
});

test("admin token accepts the right password only", () => {
  assert.equal(passwordMatches("secret", "secret"), true);
  assert.equal(passwordMatches("nope", "secret"), false);
  const token = issueToken("secret", 1_000);
  assert.equal(verifyToken(token, "secret", 1_000 + 1000), true);
  assert.equal(verifyToken(token, "other", 1_000 + 1000), false);
  assert.equal(verifyToken(token, "secret", 1_000 + 13 * 60 * 60 * 1000), false);
});

test("balls stay inside the drum after a fast mix", async () => {
  const { CONTAIN_LIMIT, containInPlace, simulateSteps } = await import("../public/drumPhysics.js");
  const outside = { x: 3, y: -1, z: 0.4 };
  const velocity = { x: 12, y: -4, z: 2 };
  assert.equal(containInPlace(outside, velocity), true);
  assert.ok(Math.hypot(outside.x, outside.y, outside.z) <= CONTAIN_LIMIT + 1e-9);
  const radial = outside.x * velocity.x + outside.y * velocity.y + outside.z * velocity.z;
  assert.ok(radial < 0);

  function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  for (const energy of [1, 2.4]) {
    const result = simulateSteps({ count: 40, steps: 420, energy, speed: 12, rand: mulberry32(energy === 1 ? 7 : 11) });
    for (const ball of result.balls) {
      assert.ok(Math.hypot(ball.x, ball.y, ball.z) <= CONTAIN_LIMIT + 1e-6);
    }
    assert.ok(result.maxRadius <= CONTAIN_LIMIT + 1e-6);
    assert.ok(result.maxY > 0.7, `upper balls at energy ${energy}: ${result.maxY}`);
    assert.ok(result.minY < -0.7, `lower balls at energy ${energy}: ${result.minY}`);
  }
});

test("the drum source has no gold ring mesh", async () => {
  const source = await readFile(new URL("../public/drum.js", import.meta.url), "utf8");
  assert.equal(/TorusGeometry|RingGeometry/.test(source), false);
  assert.equal(/0xd7a441|0xf2c14e/i.test(source), false);
  assert.match(source, /function frameCamera/);
});

test("demo countdown rehearses draw night without calling the server", async () => {
  const source = await readFile(new URL("../public/main.js", import.meta.url), "utf8");
  assert.match(source, /demo=1&countdown=10|countdown/);
  assert.match(source, /A\.B\. - Entry 840053/);
  assert.match(source, /Drawing now/);
  assert.match(source, /Demo - example data/);
  const night = source.slice(source.indexOf("function startDemoNight"), source.indexOf("function startDemo("));
  assert.equal(night.includes("fetch("), false);
  assert.match(night, /demoNightRefs\(40\)/);
});

test("draw fingerprint is a stable hash of the sorted draw inputs", () => {
  const drawnAt = "2026-10-01T19:00:00.000Z";
  const first = drawFingerprint({
    month: "2026-10",
    drawnAt,
    entryRefs: ["BBBBBB", "AAAAAA", "CCCCCC"],
    winnerIndex: 1,
  });
  const second = drawFingerprint({
    month: "2026-10",
    drawnAt,
    entryRefs: ["CCCCCC", "AAAAAA", "BBBBBB"],
    winnerIndex: 1,
  });
  const expected = createHash("sha256")
    .update(["2026-10", drawnAt, "1", "AAAAAA", "BBBBBB", "CCCCCC"].join("\n"))
    .digest("hex");
  assert.equal(first, second);
  assert.equal(first, expected);
  assert.equal(first.length, 64);
  assert.notEqual(
    drawFingerprint({
      month: "2026-10",
      drawnAt,
      entryRefs: ["AAAAAA", "BBBBBB", "CCCCCC"],
      winnerIndex: 0,
    }),
    first
  );
  const entrants = hashEntrantRefs(["CCCCCC", "AAAAAA", "BBBBBB"]);
  assert.equal(
    entrants,
    createHash("sha256").update(["AAAAAA", "BBBBBB", "CCCCCC"].join("\n")).digest("hex")
  );
  assert.notEqual(entrants, first);
});

test("history messages name CMS only for WDE0110", () => {
  assert.equal(
    historyUnavailableMessage({ message: "WDE0110: Wix CMS app is not installed for site." }),
    CMS_NOT_INSTALLED_MESSAGE
  );
  assert.equal(/Wix Editor|Add CMS/i.test(CMS_NOT_INSTALLED_MESSAGE), false);
  const other = historyUnavailableMessage({ message: "Wix returned an error: storage timeout", code: "WIX_ERROR" });
  assert.equal(other, HISTORY_UNAVAILABLE_MESSAGE);
  assert.equal(/Wix CMS|Wix Editor|Add CMS/i.test(other), false);
});

test("public winners omit names and member ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awca-"));
  process.env.WIX_MOCK = "1";
  process.env.MOCK_DRAW_FILE = join(dir, "draws.json");
  process.env.ENTRY_REF_SECRET = "committee-secret";
  delete process.env.ADMIN_PASSWORD;
  const fingerprint = "ab".repeat(32);
  const entrantsHash = "cd".repeat(32);
  await writeFile(
    process.env.MOCK_DRAW_FILE,
    JSON.stringify({
      extra: [
        {
          memberId: "member-1",
          winnerName: "Daniel Monks",
          fullName: "Daniel Monks",
          email: "daniel@example.com",
          initials: "D.M.",
          entryRef: "4F7A2C",
          month: "2026-09",
          drawnAt: "2026-09-01T19:00:00.000Z",
          entryCount: 8,
          potAmount: 10,
          fingerprint,
          entrantsHash,
          winnerIndex: 3,
        },
      ],
    }),
    "utf8"
  );
  try {
    const denied = fakeRes();
    await winnersApi({ method: "POST" }, denied);
    assert.equal(denied.statusCode, 405);

    const res = fakeRes();
    await winnersApi({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["cache-control"], /s-maxage=300/);
    assert.equal(res.body.historyAvailable, true);
    assert.equal("message" in res.body, false);
    const winner = res.body.winners.find((draw) => draw.month === "2026-09");
    assert.equal(winner.label, "D.M. - Entry 4F7A2C");
    assert.equal(winner.pot, 10);
    assert.equal(winner.entryCount, 8);
    assert.equal(winner.drawnAt, "2026-09-01T19:00:00.000Z");
    assert.equal(winner.fingerprint, fingerprint);
    assert.equal(winner.entrantsHash, entrantsHash);
    const allowed = new Set([
      "month",
      "label",
      "pot",
      "potLabel",
      "entryCount",
      "drawnAt",
      "drawnAtLabel",
      "fingerprint",
      "entrantsHash",
    ]);
    for (const draw of res.body.winners) {
      for (const key of Object.keys(draw)) {
        assert.equal(allowed.has(key), true, key);
      }
      assert.match(draw.label, /^(?:[A-Z](?:\.[A-Z])*\. - )?Entry [0-9A-F]{6}$|^[A-Z](?:\.[A-Z])*\. - Entry [0-9A-F]{6}$/);
    }
    const json = JSON.stringify(res.body);
    assert.equal(json.includes("Daniel Monks"), false);
    assert.equal(json.includes("member-1"), false);
    assert.equal(json.includes("mock-sam"), false);
    assert.equal(json.includes("daniel@example.com"), false);
    assert.equal(json.includes("memberId"), false);
    assert.equal(json.includes("winnerName"), false);
    assert.equal(json.includes("fullName"), false);
    assert.equal(json.includes("email"), false);
    assert.equal(json.includes("@"), false);
    assert.equal(json.includes("Sample"), false);
  } finally {
    restoreEnv();
  }
});

test("other storage errors stay neutral and are not cached as winners", async () => {
  delete process.env.WIX_MOCK;
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "site";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "storage timeout" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  try {
    const body = await getPublicWinners();
    assert.equal(body.historyAvailable, false);
    assert.equal(body.message, HISTORY_UNAVAILABLE_MESSAGE);
    assert.equal(/Wix CMS|Wix Editor|Add CMS|WIX_API_KEY/i.test(body.message), false);
    assert.deepEqual(body.winners, []);

    const res = fakeRes();
    await winnersApi({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.message, HISTORY_UNAVAILABLE_MESSAGE);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("public winners do not explain how to configure Wix", async () => {
  delete process.env.WIX_MOCK;
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  try {
    const body = await getPublicWinners();
    assert.equal(body.historyAvailable, false);
    assert.equal(body.message, HISTORY_UNAVAILABLE_MESSAGE);
    assert.equal(JSON.stringify(body).includes("WIX_API_KEY"), false);
    assert.equal(/Wix Editor|Add CMS/i.test(body.message), false);
  } finally {
    restoreEnv();
  }
});

test("a saved draw keeps the month as the item id and stores the fingerprint", async () => {
  delete process.env.WIX_MOCK;
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "site";
  process.env.ENTRY_REF_SECRET = "committee-secret";
  const originalFetch = globalThis.fetch;
  const fingerprint = "ab".repeat(32);
  const entrantsHash = "cd".repeat(32);
  let posted = null;
  let createdFields = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (path.includes("/collections/create-field")) {
      createdFields += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.dataCollectionId, "LotteryDraws");
      return json({});
    }
    if (path.includes("/wix-data/v2/collections/")) {
      return json({ collection: { fields: [] } });
    }
    if (path.endsWith("/wix-data/v2/items") && options.method === "POST") {
      posted = JSON.parse(options.body);
      return json({ dataItem: posted.dataItem });
    }
    throw new Error(`Unexpected Wix call ${path}`);
  };
  try {
    const result = await insertDrawIfAbsent({
      memberId: "member-1",
      initials: "D.M.",
      entryRef: "4F7A2C",
      month: "2026-10",
      drawnAt: "2026-10-01T19:00:00.000Z",
      entryCount: 3,
      potAmount: 3.75,
      fingerprint,
      entrantsHash,
      winnerIndex: 0,
    });
    assert.equal(createdFields, 3);
    assert.equal(posted.dataItem.id, "2026-10");
    assert.equal(posted.dataItem.data.fingerprint, fingerprint);
    assert.equal(posted.dataItem.data.entrantsHash, entrantsHash);
    assert.equal(posted.dataItem.data.winnerIndex, 0);
    assert.equal(posted.dataItem.data.memberId, "member-1");
    assert.equal("winnerName" in posted.dataItem.data, false);
    assert.equal(result.created, true);
    assert.equal(result.record.fingerprint, fingerprint);
    assert.equal(result.record.winnerIndex, 0);
    assert.equal(JSON.stringify(result.record).includes("Daniel"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

const EMBED_FRAME_ANCESTORS =
  "frame-ancestors https://www.alconbury-weald.org https://alconbury-weald.org https://*.wix.com https://*.wixsite.com https://*.filesusr.com https://*.wixstatic.com";

test("only the winners embed can be framed, and only by the Wix site", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const embed = config.headers.find((rule) => rule.source === "/winners-embed");
  const embedCsp = embed.headers.find((header) => header.key === "Content-Security-Policy").value;
  assert.equal(embedCsp, EMBED_FRAME_ANCESTORS);
  assert.equal(embed.headers.some((header) => header.key === "X-Frame-Options"), false);
  const nested = config.headers.find((rule) => rule.source === "/winners-embed/(.*)");
  assert.equal(nested.headers.find((header) => header.key === "Content-Security-Policy").value, EMBED_FRAME_ANCESTORS);
  const deny = config.headers.find((rule) => rule.source.includes("(?!winners-embed)"));
  assert.equal(deny.headers.find((header) => header.key === "Content-Security-Policy").value, "frame-ancestors 'none'");
  assert.equal(deny.headers.find((header) => header.key === "X-Frame-Options").value, "DENY");
});

test("public copy does not tell visitors to add CMS in the editor", async () => {
  const files = ["../lib/store.js", "../public/main.js", "../public/winners-embed/index.html", "../README.md"];
  for (const file of files) {
    const text = await readFile(new URL(file, import.meta.url), "utf8");
    assert.equal(/Add CMS in the Wix Editor/i.test(text), false, file);
  }
  const embed = await readFile(new URL("../public/winners-embed/index.html", import.meta.url), "utf8");
  assert.match(embed, /No draws yet\. The first draw is on 1 October 2026 at 8pm\./);
  assert.match(embed, /Example data\. Not a real draw\./);
  assert.match(embed, /\/api\/winners/);
  assert.match(embed, /createElement\("details"\)/);
  const main = await readFile(new URL("../public/main.js", import.meta.url), "utf8");
  assert.match(main, /Fairness check: \$\{draw\.fingerprint\}/);
  assert.match(main, /Entrants check: \$\{draw\.entrantsHash\}/);
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
