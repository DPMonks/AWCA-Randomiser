import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import cronDraw from "../api/cron/draw.js";
import { activeEntrants, buildMembers } from "../lib/entrants.js";
import { potFor } from "../lib/format.js";
import { ensureMonthlyDraw, getMemberList, getPublicState } from "../lib/lottery.js";
import {
  MANUAL_FIRST_MONTH,
  buildManualEntries,
  manualCoversDraw,
  manualEndInstant,
  manualMemberId,
} from "../lib/manual-entrants.js";
import { displayEntryRef, entryReference } from "../lib/privacy.js";

const savedEnv = { ...process.env };
const BALL_REF = /^[0-9A-F]{6}(?: \((?:[2-9]|[1-9]\d+)\))?$/;

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("manual cover starts in November 2026 and stops after lastDrawMonth", () => {
  assert.equal(MANUAL_FIRST_MONTH, "2026-11");
  assert.equal(manualCoversDraw("2026-12", "2026-10"), false);
  assert.equal(manualCoversDraw("2026-12", "2026-11"), true);
  assert.equal(manualCoversDraw("2026-12", "2026-12"), true);
  assert.equal(manualCoversDraw("2026-12", "2027-01"), false);
  assert.equal(manualCoversDraw("2026-11", "2026-11"), true);
  assert.equal(manualCoversDraw("2026-11", "2026-12"), false);
  assert.equal(manualCoversDraw("2026-10", "2026-11"), false);
  assert.equal(manualCoversDraw("2026-13", "2026-11"), false);
  assert.equal(manualCoversDraw("2026-12", ""), false);
});

test("manual rows default, expire, sum, and keep distinct entry codes", () => {
  process.env.ENTRY_REF_SECRET = "committee-secret";
  try {
    const rows = [
      { id: "b", data: { email: "test1@example.com", entriesPerDraw: 1, lastDrawMonth: "2026-12", name: "Aaron Example" } },
      { id: "a", data: { email: "TEST1@example.com", lastDrawMonth: "2026-12", name: "Aaron Example" } },
      { id: "c", data: { email: "test2@example.com", lastDrawMonth: "2026-11" } },
      { id: "d", data: { email: "test3@example.com", entriesPerDraw: 2, lastDrawMonth: "2026-10" } },
      { id: "e", data: { email: "not-an-email", entriesPerDraw: 4, lastDrawMonth: "2026-12" } },
      { id: "f", data: { email: "test4@example.com", entriesPerDraw: 0, lastDrawMonth: "2026-12" } },
    ];
    const november = buildManualEntries(rows, "2026-11", new Set());
    const active = november.entries.filter((entry) => entry.active);
    assert.equal(active.length, 3);
    assert.equal(november.skipped, 2);
    const test1 = active.filter((entry) => entry.email === "test1@example.com");
    assert.equal(test1.length, 2);
    assert.equal(test1[0].memberId, test1[1].memberId);
    assert.deepEqual(test1.map((entry) => entry.entryNumber), [1, 2]);
    assert.equal(displayEntryRef(test1[0].memberId, 1).includes("("), false);
    assert.match(displayEntryRef(test1[1].memberId, 2), / \(2\)$/);
    assert.equal(active.filter((entry) => entry.email === "test2@example.com").length, 1);
    assert.equal(active.some((entry) => entry.email === "test3@example.com"), false);

    const december = buildManualEntries(rows, "2026-12", new Set()).entries.filter((entry) => entry.active);
    assert.equal(december.filter((entry) => entry.email === "test1@example.com").length, 2);
    assert.equal(december.some((entry) => entry.email === "test2@example.com"), false);

    const january = buildManualEntries(rows, "2027-01", new Set()).entries.filter((entry) => entry.active);
    assert.equal(january.length, 0);

    const planRef = entryReference("member-1");
    const manualRef = displayEntryRef(manualMemberId("test1@example.com"), 1);
    assert.notEqual(planRef, manualRef);

    const blocked = buildManualEntries(
      [{ id: "a", data: { email: "test1@example.com", entriesPerDraw: 1, lastDrawMonth: "2026-12" } }],
      "2026-11",
      new Set([manualRef])
    );
    const moved = blocked.entries.find((entry) => entry.active);
    assert.notEqual(moved.memberId, manualMemberId("test1@example.com"));
    assert.notEqual(displayEntryRef(moved.memberId, 1), manualRef);

    const capped = buildManualEntries(
      [
        { id: "a", data: { email: "test5@example.com", entriesPerDraw: 60, lastDrawMonth: "2026-12" } },
        { id: "b", data: { email: "test5@example.com", entriesPerDraw: 60, lastDrawMonth: "2026-12" } },
      ],
      "2026-11",
      new Set()
    );
    assert.equal(capped.entries.filter((entry) => entry.active).length, 100);
    assert.equal(capped.capped, 1);
    assert.equal(new Date(manualEndInstant("2026-12")).toISOString().startsWith("2026-12-31"), true);
  } finally {
    restoreEnv();
  }
});

test("public state counts manual entries in the pot and keeps emails off the page", async () => {
  const originalFetch = globalThis.fetch;
  const saved = [];
  const manualRows = [
    { id: "b", data: { email: "test1@example.com", entriesPerDraw: 1, lastDrawMonth: "2026-12", name: "Aaron Example" } },
    { id: "a", data: { email: "test1@example.com", lastDrawMonth: "2026-12", name: "Aaron Example" } },
    { id: "c", data: { email: "test2@example.com", lastDrawMonth: "2026-11", name: "Zara Example" } },
    { id: "d", data: { email: "test3@example.com", entriesPerDraw: 2, lastDrawMonth: "2026-10", name: "Old Example" } },
    { id: "e", data: { email: "not-an-email", lastDrawMonth: "2026-12" } },
  ];

  delete process.env.WIX_MOCK;
  delete process.env.VERCEL_ENV;
  delete process.env.EMAIL_ENABLED;
  delete process.env.EMAIL_DRY_RUN;
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "site";
  process.env.WIX_LOTTERY_PLAN_ID = "plan-lottery";
  process.env.ENTRY_REF_SECRET = "committee-secret";
  process.env.ADMIN_PASSWORD = "committee-secret";

  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes("/pricing-plans/v3/plans/query")) {
      return jsonResponse({
        plans: [{ id: "plan-lottery", name: "AWCA Lottery", currency: "GBP" }],
      });
    }
    if (path.includes("/pricing-plans/v2/orders")) {
      return jsonResponse({
        orders: [
          {
            id: "order-1",
            status: "ACTIVE",
            buyer: { memberId: "member-1" },
            startDate: "2026-01-01T00:00:00.000Z",
            createdDate: "2026-01-01T00:00:00.000Z",
          },
        ],
        pagingMetadata: { total: 1, hasNext: false },
      });
    }
    if (path.includes("/members/v1/members/query")) {
      return jsonResponse({
        members: [
          {
            id: "member-1",
            loginEmail: "test1@example.com",
            contact: { firstName: "Aaron", lastName: "Example" },
          },
        ],
      });
    }
    if (path.includes("/wix-data/v2/collections/")) {
      return jsonResponse({
        collection: {
          fields: [
            { key: "fingerprint" },
            { key: "entrantsHash" },
            { key: "winnerIndex" },
            { key: "emailSent" },
          ],
        },
      });
    }
    if (path.includes("/wix-data/v2/items/query")) {
      const body = JSON.parse(options.body || "{}");
      if (body.dataCollectionId === "ManualEntrants") return jsonResponse({ dataItems: manualRows });
      return jsonResponse({ dataItems: saved });
    }
    if (path.includes("/wix-data/v2/items") && options.method === "POST") {
      const body = JSON.parse(options.body);
      saved.unshift(body.dataItem);
      return jsonResponse({ dataItem: body.dataItem });
    }
    throw new Error(`Unexpected Wix call ${path}`);
  };

  try {
    const names = new Map([["member-1", "Aaron Example"]]);
    const orders = [
      {
        id: "order-1",
        status: "ACTIVE",
        buyer: { memberId: "member-1" },
        startDate: "2026-01-01T00:00:00.000Z",
        createdDate: "2026-01-01T00:00:00.000Z",
      },
    ];
    const planMembers = buildMembers(orders, names);
    const manual = buildManualEntries(manualRows, "2026-11", new Set([displayEntryRef("member-1", 1)]));
    const novemberEntrants = activeEntrants([...planMembers, ...manual.entries]);
    assert.equal(novemberEntrants.length, 4);
    assert.equal(potFor(novemberEntrants.length), 5);
    const test2Index = novemberEntrants.findIndex((entry) => entry.email === "test2@example.com");
    assert.equal(test2Index >= 0, true);
    const planCode = displayEntryRef("member-1", 1);
    const manualCodes = novemberEntrants
      .filter((entry) => entry.email === "test1@example.com" && entry.source === "manual")
      .map((entry) => displayEntryRef(entry.memberId, entry.entryNumber));
    assert.equal(manualCodes.includes(planCode), false);
    assert.equal(new Set([planCode, ...manualCodes]).size, 1 + manualCodes.length);

    const before = await getPublicState([], new Date("2026-10-31T12:00:00.000Z"));
    assert.equal(before.activeEntries, 4);
    assert.equal(before.pot, 5);
    assert.equal(before.potLabel, "£5.00");
    assert.equal(before.nextDrawLabel, "1 November 2026, 20:00 UK time");
    assert.equal(before.entryRefs.length, 4);
    for (const ref of before.entryRefs) assert.match(ref, BALL_REF);
    assert.equal(JSON.stringify(before).includes("@"), false);
    assert.equal(JSON.stringify(before).includes("email"), false);
    assert.equal(JSON.stringify(before).includes("test1"), false);
    assert.equal(JSON.stringify(before).includes("test2"), false);
    assert.equal(JSON.stringify(before).includes("Aaron"), false);

    const afternoon = await getPublicState([], new Date("2026-11-01T15:00:00.000Z"));
    assert.equal(afternoon.activeEntries, 4);
    assert.equal(afternoon.pot, 5);
    assert.equal(afternoon.drawDue, false);
    assert.equal(afternoon.nextDrawLabel, "1 November 2026, 20:00 UK time");
    assert.deepEqual([...afternoon.entryRefs].sort(), [...before.entryRefs].sort());

    const drawn = await ensureMonthlyDraw({
      now: new Date("2026-11-01T20:00:00.000Z"),
      randomIntFn: () => test2Index,
    });
    assert.equal(drawn.created, true);
    assert.equal(drawn.record.month, "2026-11");
    assert.equal(drawn.record.entryCount, 4);
    assert.equal(drawn.record.potAmount, 5);
    assert.equal(drawn.record.entryRef, displayEntryRef(novemberEntrants[test2Index].memberId, novemberEntrants[test2Index].entryNumber));
    assert.equal(drawn.record.initials, "Z.E.");
    assert.equal(JSON.stringify(drawn.record).includes("@"), false);
    assert.equal(JSON.stringify(drawn.record).includes("test2"), false);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, "2026-11");

    const after = await getPublicState([], new Date("2026-11-01T20:30:00.000Z"));
    assert.equal(after.lastWinner.month, "2026-11");
    assert.equal(after.lastWinner.entryCount, 4);
    assert.equal(after.lastWinner.pot, 5);
    assert.equal(after.lastWinner.label, `Z.E. - Entry ${drawn.record.entryRef}`);
    assert.equal(after.activeEntries, 3);
    assert.equal(after.pot, 3.75);
    assert.equal(after.nextDrawLabel, "1 December 2026, 20:00 UK time");
    assert.equal(after.entryRefs.includes(drawn.record.entryRef), false);
    assert.equal(JSON.stringify(after).includes("@"), false);
    assert.equal(JSON.stringify(after).includes("email"), false);

    const members = await getMemberList(new Date("2026-11-01T15:00:00.000Z"));
    assert.equal(members.members.some((member) => member.email === "test2@example.com"), true);
    assert.equal(members.members.some((member) => member.email === "test1@example.com"), true);
    const ended = members.members.find((member) => member.email === "test3@example.com");
    assert.equal(ended.status, "Ended");
    assert.equal(ended.endLabel, "31 October 2026");
    const prepaid = members.members.find((member) => member.email === "test2@example.com");
    assert.equal(prepaid.endLabel, "30 November 2026");

    const january = await ensureMonthlyDraw({
      now: new Date("2027-01-01T20:00:00.000Z"),
      force: true,
      randomIntFn: () => 0,
    });
    assert.equal(january.record.month, "2027-01");
    assert.equal(january.record.entryCount, 1);
    assert.equal(january.record.potAmount, 1.25);
    assert.equal(january.record.entryRef, planCode);
    assert.equal(january.record.memberId, "member-1");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("a missing manual collection still serves plan orders and blocks the draw", async () => {
  const originalFetch = globalThis.fetch;
  let inserts = 0;
  delete process.env.WIX_MOCK;
  delete process.env.VERCEL_ENV;
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "site";
  process.env.WIX_LOTTERY_PLAN_ID = "plan-lottery";
  process.env.ENTRY_REF_SECRET = "committee-secret";

  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes("/pricing-plans/v3/plans/query")) {
      return jsonResponse({ plans: [{ id: "plan-lottery", name: "AWCA Lottery", currency: "GBP" }] });
    }
    if (path.includes("/pricing-plans/v2/orders")) {
      return jsonResponse({
        orders: [{ id: "order-1", status: "ACTIVE", buyer: { memberId: "member-1" }, startDate: "2026-01-01T00:00:00.000Z" }],
        pagingMetadata: { total: 1, hasNext: false },
      });
    }
    if (path.includes("/members/v1/members/query")) {
      return jsonResponse({
        members: [{ id: "member-1", loginEmail: "test1@example.com", contact: { firstName: "Aaron", lastName: "Example" } }],
      });
    }
    if (path.includes("/wix-data/v2/items/query")) {
      const body = JSON.parse(options.body || "{}");
      if (body.dataCollectionId === "ManualEntrants") {
        return jsonResponse({ message: "WDE0025: Collection ManualEntrants does not exist" }, 404);
      }
      return jsonResponse({ dataItems: [] });
    }
    if (path.includes("/wix-data/v2/collections/")) {
      return jsonResponse({ collection: { fields: [{ key: "emailSent" }, { key: "fingerprint" }, { key: "entrantsHash" }, { key: "winnerIndex" }] } });
    }
    if (path.includes("/wix-data/v2/items") && options.method === "POST") {
      inserts += 1;
      return jsonResponse({ dataItem: {} });
    }
    throw new Error(`Unexpected Wix call ${path}`);
  };

  try {
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      const state = await getPublicState([], new Date("2026-11-01T15:00:00.000Z"));
      assert.equal(state.activeEntries, 1);
      assert.equal(state.pot, 1.25);
      assert.equal(JSON.stringify(state).includes("@"), false);
      await assert.rejects(
        ensureMonthlyDraw({ now: new Date("2026-11-01T20:00:00.000Z") }),
        /Manual entrants could not be read/
      );
    } finally {
      console.error = originalError;
    }
    assert.equal(inserts, 0);
    assert.equal(logs.join("\n").includes("@"), false);
    assert.match(logs.join("\n"), /manual entrants unavailable/i);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("an empty manual collection is not an error and the draw uses plan orders", async () => {
  const originalFetch = globalThis.fetch;
  const saved = [];
  delete process.env.WIX_MOCK;
  delete process.env.VERCEL_ENV;
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "site";
  process.env.WIX_LOTTERY_PLAN_ID = "plan-lottery";
  process.env.ENTRY_REF_SECRET = "committee-secret";

  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes("/pricing-plans/v3/plans/query")) {
      return jsonResponse({ plans: [{ id: "plan-lottery", name: "AWCA Lottery", currency: "GBP" }] });
    }
    if (path.includes("/pricing-plans/v2/orders")) {
      return jsonResponse({
        orders: [{ id: "order-1", status: "ACTIVE", buyer: { memberId: "member-1" }, startDate: "2026-01-01T00:00:00.000Z" }],
        pagingMetadata: { total: 1, hasNext: false },
      });
    }
    if (path.includes("/members/v1/members/query")) {
      return jsonResponse({
        members: [{ id: "member-1", loginEmail: "test1@example.com", contact: { firstName: "Aaron", lastName: "Example" } }],
      });
    }
    if (path.includes("/wix-data/v2/items/query")) {
      return jsonResponse({ dataItems: saved });
    }
    if (path.includes("/wix-data/v2/collections/")) {
      return jsonResponse({
        collection: { fields: [{ key: "fingerprint" }, { key: "entrantsHash" }, { key: "winnerIndex" }, { key: "emailSent" }] },
      });
    }
    if (path.includes("/wix-data/v2/items") && options.method === "POST") {
      const body = JSON.parse(options.body);
      saved.unshift(body.dataItem);
      return jsonResponse({ dataItem: body.dataItem });
    }
    throw new Error(`Unexpected Wix call ${path}`);
  };

  try {
    const drawn = await ensureMonthlyDraw({ now: new Date("2026-11-01T20:00:00.000Z"), randomIntFn: () => 0 });
    assert.equal(drawn.created, true);
    assert.equal(drawn.record.entryCount, 1);
    assert.equal(drawn.record.potAmount, 1.25);
    assert.equal(drawn.record.memberId, "member-1");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("preview deployments do not draw or write history", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  delete process.env.WIX_MOCK;
  process.env.VERCEL_ENV = "preview";
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "site";
  process.env.CRON_SECRET = "cron-secret";
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("preview touched the network");
  };
  try {
    const blocked = await ensureMonthlyDraw({ now: new Date("2026-11-01T20:00:00.000Z"), force: true });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.created, false);
    assert.equal(blocked.record, null);
    assert.equal(calls, 0);

    const cron = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      headers: {},
      setHeader() {},
      send(payload) {
        this.body = JSON.parse(payload);
      },
    };
    await cronDraw(
      {
        method: "GET",
        headers: { authorization: "Bearer cron-secret" },
        drawNow: new Date("2026-11-01T20:00:00.000Z"),
      },
      cron
    );
    assert.equal(cron.statusCode, 200);
    assert.equal(cron.body.skipped, true);
    assert.equal(cron.body.created, false);
    assert.match(cron.body.reason, /production/i);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("the drum builds one ball per public entry code", async () => {
  process.env.ENTRY_REF_SECRET = "committee-secret";
  try {
    const drum = await readFile(new URL("../public/drum.js", import.meta.url), "utf8");
    const main = await readFile(new URL("../public/main.js", import.meta.url), "utf8");
    const rules = await readFile(new URL("../public/rules/index.html", import.meta.url), "utf8");
    assert.match(drum, /function setEntries\(refs\)/);
    assert.match(drum, /ballEntries\(refs\)/);
    assert.match(main, /data\.entryBalls/);
    assert.match(rules, /Some entries were prepaid under the previous manual system\. These entries are valid for each monthly draw up to the end date shown on the entry and then end automatically\./);
    const line = rules.split("\n").find((item) => item.includes("previous manual system"));
    assert.equal(line.includes("\u2013"), false);
    assert.equal(line.includes("\u2014"), false);
    for (const ref of ["4F7A2C", "4F7A2C (2)", displayEntryRef(manualMemberId("test1@example.com"), 2)]) {
      assert.match(ref, BALL_REF);
    }
  } finally {
    restoreEnv();
  }
});
