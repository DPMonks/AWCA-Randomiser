import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { issueToken } from "../lib/auth.js";
import { londonMonthKey } from "../lib/format.js";
import { buildSubscriptionRows, getBusinessSubscriptions } from "../lib/business-report.js";
import { recordBusinessStats } from "../lib/biz-stats.js";
import { createMemoryStore } from "../lib/rate-limit.js";
import { createHandler } from "../api/business-subscriptions.js";

const PLAN_ID = "plan-business";
const PLANS = [{ id: PLAN_ID, name: "AWCA Business Membership" }];
const NOW = new Date("2026-06-15T12:00:00.000Z");
const FUTURE = "2026-10-01T00:00:00.000Z";
const PAST = "2026-05-01T00:00:00.000Z";
const EMAIL = "owner.private@weald.example";

function order(overrides = {}) {
  return {
    id: overrides.id || "o1",
    planId: PLAN_ID,
    status: "ACTIVE",
    buyer: { memberId: "member-private", contactId: "contact-private" },
    startDate: "2026-09-01T10:00:00.000Z",
    formData: {
      submissionData: {
        business_name: "Weald Coffee Co",
        company_website: "https://weald.example/menu",
        email: EMAIL,
        business_email: "desk@weald.example",
      },
    },
    ...overrides,
  };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    send(body) { this.body = body; },
  };
}

function adminReq(method = "GET") {
  const token = issueToken("committee-secret");
  return {
    method,
    headers: { cookie: `awca_admin=${encodeURIComponent(token)}` },
  };
}

test("subscription rows list every order and mark only the one on the site", () => {
  const shown = order({
    id: "shown",
    currentCycle: { endedDate: FUTURE },
  });
  const expired = order({
    id: "expired",
    buyer: { memberId: "member-2" },
    endDate: PAST,
    formData: { submissionData: { business_name: "Closed Shop", email: EMAIL } },
  });
  const rows = buildSubscriptionRows([expired, shown], { planId: PLAN_ID, now: NOW.getTime() }, {
    "weald-coffee-co": { views: 4, clicks: 2 },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Weald Coffee Co");
  assert.equal(rows[0].displayed, true);
  assert.equal(rows[0].website, "https://weald.example/menu");
  assert.equal(rows[0].status, "Active");
  assert.equal(rows[0].startLabel, "1 September 2026");
  assert.equal(rows[0].endLabel, "1 October 2026 (Next renewal)");
  assert.equal(rows[0].views, 4);
  assert.equal(rows[0].clicks, 2);
  assert.equal(rows[1].name, "Closed Shop");
  assert.equal(rows[1].displayed, false);
  assert.equal(rows[1].status, "Ended");
  assert.equal(JSON.stringify(rows).includes(EMAIL), false);
  assert.equal(JSON.stringify(rows).includes("member-private"), false);
});

test("missing stats are reported as unavailable rather than zero", () => {
  const rows = buildSubscriptionRows([order()], { planId: PLAN_ID, now: NOW.getTime(), statsAvailable: false }, {});
  assert.equal(rows[0].views, null);
  assert.equal(rows[0].clicks, null);
});

test("the admin subscriptions route requires the existing admin session", async () => {
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "committee-secret";
  const handler = createHandler({
    listPlans: async () => PLANS,
    listOrdersForPlan: async () => [],
    statsStore: createMemoryStore(),
  });
  try {
    const denied = mockRes();
    await handler({ method: "GET", headers: {} }, denied);
    assert.equal(denied.statusCode, 401);
    const wrong = mockRes();
    await handler({ method: "POST", headers: {} }, wrong);
    assert.equal(wrong.statusCode, 405);
  } finally {
    if (previous == null) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});

test("the admin route returns names, dates, display, and monthly counts", async () => {
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "committee-secret";
  const store = createMemoryStore();
  const countedAt = new Date();
  await recordBusinessStats(store, {
    type: "view",
    slugs: ["weald-coffee-co", "weald-coffee-co"],
    now: countedAt,
  });
  await recordBusinessStats(store, { type: "view", slugs: ["weald-coffee-co"], now: countedAt });
  await recordBusinessStats(store, { type: "click", slugs: ["weald-coffee-co"], now: countedAt });
  const handler = createHandler({
    listPlans: async () => PLANS,
    listOrdersForPlan: async () => [order({ currentCycle: { endDate: FUTURE } })],
    statsStore: store,
  });
  try {
    const res = mockRes();
    await handler(adminReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    const body = JSON.parse(res.body);
    assert.equal(body.available, true);
    assert.equal(body.month, londonMonthKey(countedAt));
    assert.equal(body.statsAvailable, true);
    assert.equal(body.subscriptions.length, 1);
    assert.equal(body.subscriptions[0].displayed, true);
    assert.equal(body.subscriptions[0].views, 2);
    assert.equal(body.subscriptions[0].clicks, 1);
    assert.equal(res.body.includes(EMAIL), false);
    assert.equal(res.body.includes("member-private"), false);
    assert.equal(res.headers["set-cookie"], undefined);
  } finally {
    if (previous == null) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});

test("a stats store failure leaves the subscription list and marks counts unavailable", async () => {
  const store = {
    async get() { throw new Error("redis down"); },
    async incr() { throw new Error("redis down"); },
  };
  const body = await getBusinessSubscriptions({
    listPlans: async () => PLANS,
    listOrdersForPlan: async () => [order()],
  }, {}, { now: NOW, store });
  assert.equal(body.available, true);
  assert.equal(body.statsAvailable, false);
  assert.equal(body.subscriptions[0].views, null);
  assert.equal(body.subscriptions[0].clicks, null);
});

test("the admin page has a business subscriptions table", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
  assert.match(html, /<h3>Business subscriptions<\/h3>/);
  assert.match(html, /Views this month/);
  assert.match(html, /Clicks this month/);
  assert.match(html, /On the site/);
  assert.match(html, /End date or next renewal/);
  assert.match(main, /\/api\/business-subscriptions/);
  const renderer = main.slice(
    main.indexOf("function renderBusinessSubscriptions"),
    main.indexOf("async function loadBusinessSubscriptions")
  );
  assert.equal(renderer.includes("data-business-click"), false);
  assert.match(renderer, /unavailable/);
  assert.match(main, /function countCell/);
  assert.match(main, /Unavailable/);
});
