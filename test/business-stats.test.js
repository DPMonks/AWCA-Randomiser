import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHandler as createStatsHandler } from "../api/business-stats.js";
import { createHandler as createGoHandler } from "../api/business-go.js";
import { cleanStatSlugs, isStatsBot, readBusinessStats, recordBusinessStats, statKey } from "../lib/biz-stats.js";
import { renderBusinessPage, renderDirectoryPage } from "../lib/business-pages.js";
import { createMemoryStore } from "../lib/rate-limit.js";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const PLAN_ID = "plan-business";

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key.toLowerCase()] = String(value); },
    send(body) { this.body = body == null ? "" : String(body); },
  };
}

function order() {
  return {
    id: "o1",
    planId: PLAN_ID,
    status: "ACTIVE",
    buyer: { memberId: "m1" },
    startDate: "2026-01-01T00:00:00.000Z",
    formData: {
      submissionData: {
        business_name: "Weald Coffee Co",
        company_website: "https://weald.example/menu",
        email: "owner.private@weald.example",
      },
    },
  };
}

test("bots are ignored and slugs are cleaned without storing anything else", () => {
  assert.equal(isStatsBot({ headers: { "user-agent": "Mozilla/5.0 Googlebot" } }), true);
  assert.equal(isStatsBot({ headers: { "user-agent": "curl/8.0" } }), true);
  assert.equal(isStatsBot({ headers: { "user-agent": "Mozilla/5.0 (compatible; visitor)" } }), false);
  assert.equal(isStatsBot({ headers: {} }), false);
  assert.deepEqual(cleanStatSlugs(["weald-coffee-co", "weald-coffee-co", "NOT A SLUG", "", "a".repeat(81)]), ["weald-coffee-co"]);
});

test("monthly views and clicks increment in the memory store", async () => {
  const store = createMemoryStore();
  await recordBusinessStats(store, { type: "view", slugs: ["weald-coffee-co", "bakery"], now: NOW });
  await recordBusinessStats(store, { type: "view", slugs: ["weald-coffee-co"], now: NOW });
  await recordBusinessStats(store, { type: "click", slugs: ["weald-coffee-co"], now: NOW });
  const read = await readBusinessStats(store, ["weald-coffee-co", "bakery"], NOW);
  assert.equal(read.month, "2026-09");
  assert.deepEqual(read.stats["weald-coffee-co"], { views: 2, clicks: 1 });
  assert.deepEqual(read.stats.bakery, { views: 1, clicks: 0 });
  assert.equal(await store.get(statKey("2026-09", "view", "weald-coffee-co")), "2");
});

test("the beacon accepts one view or click and skips bots", async () => {
  const store = createMemoryStore();
  const handler = createStatsHandler({ statsStore: store });
  const view = mockRes();
  await handler({
    method: "POST",
    headers: { "user-agent": "Mozilla/5.0" },
    body: { type: "view", slugs: ["weald-coffee-co", "weald-coffee-co"] },
  }, view);
  assert.equal(view.statusCode, 204);
  assert.equal(view.body, "");
  assert.equal(view.headers["cache-control"], "no-store");
  assert.equal(view.headers["set-cookie"], undefined);

  const bot = mockRes();
  await handler({
    method: "POST",
    headers: { "user-agent": "curl/8.0" },
    body: { type: "click", slugs: ["weald-coffee-co"] },
  }, bot);
  assert.equal(bot.statusCode, 204);

  const empty = mockRes();
  await handler({
    method: "POST",
    headers: { "user-agent": "Mozilla/5.0" },
    body: { type: "share", slugs: ["weald-coffee-co"] },
  }, empty);
  assert.equal(empty.statusCode, 204);

  const get = mockRes();
  await handler({ method: "GET", headers: {} }, get);
  assert.equal(get.statusCode, 405);

  const read = await readBusinessStats(store, ["weald-coffee-co"], new Date());
  assert.equal(read.stats["weald-coffee-co"].views, 1);
  assert.equal(read.stats["weald-coffee-co"].clicks, 0);
});

test("a stats failure still returns an empty success", async () => {
  const handler = createStatsHandler({
    statsStore: { async incr() { throw new Error("redis down"); } },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: { "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({ type: "click", slugs: ["weald-coffee-co"] }),
  }, res);
  assert.equal(res.statusCode, 204);
});

test("go redirects to the website and counts a human click", async () => {
  const store = createMemoryStore();
  const handler = createGoHandler({
    listPlans: async () => [{ id: PLAN_ID, name: "AWCA Business Membership" }],
    listOrdersForPlan: async () => [order()],
    statsStore: store,
  });
  const res = mockRes();
  await handler({
    method: "GET",
    query: { slug: "weald-coffee-co" },
    headers: { "user-agent": "Mozilla/5.0" },
  }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "https://weald.example/menu");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
  assert.equal(res.headers["set-cookie"], undefined);
  const read = await readBusinessStats(store, ["weald-coffee-co"], new Date());
  assert.equal(read.stats["weald-coffee-co"].clicks, 1);

  const bot = mockRes();
  await handler({
    method: "GET",
    query: { slug: "weald-coffee-co" },
    headers: { "user-agent": "facebookexternalhit/1.1" },
  }, bot);
  assert.equal(bot.statusCode, 302);
  assert.equal(bot.headers.location, "https://weald.example/menu");
  const afterBot = await readBusinessStats(store, ["weald-coffee-co"], new Date());
  assert.equal(afterBot.stats["weald-coffee-co"].clicks, 1);

  const missing = mockRes();
  await handler({ method: "GET", query: { slug: "not a slug" }, headers: { "user-agent": "Mozilla/5.0" } }, missing);
  assert.equal(missing.statusCode, 302);
  assert.equal(missing.headers.location, "https://lottery.alconbury-weald.org/businesses");

  const unknown = mockRes();
  await handler({ method: "GET", query: { slug: "other-shop" }, headers: { "user-agent": "Mozilla/5.0" } }, unknown);
  assert.equal(unknown.headers.location, "https://lottery.alconbury-weald.org/businesses");
  const afterUnknown = await readBusinessStats(store, ["other-shop"], new Date());
  assert.equal(afterUnknown.stats["other-shop"].clicks, 0);
});

test("pages record a view per displayed business and debounce it in the beacon", () => {
  const beacon = readFileSync(new URL("../public/biz-beacon.js", import.meta.url), "utf8");
  const embed = readFileSync(new URL("../public/business-embed/index.html", import.meta.url), "utf8");
  const home = readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
  const supporter = { name: "Weald Coffee Co", slug: "weald-coffee-co", logoUrl: null, website: "https://weald.example" };
  const directory = renderDirectoryPage([supporter]);
  const profile = renderBusinessPage(supporter);
  assert.match(beacon, /sent\.view/);
  assert.match(beacon, /\/api\/business-stats/);
  assert.equal(beacon.includes("document.cookie"), false);
  assert.match(embed, /data-business-view/);
  assert.match(embed, /awcaRecordViews/);
  assert.match(home, /awcaRecordViews/);
  assert.match(directory, /data-business-view="weald-coffee-co"/);
  assert.match(directory, /data-business-click="weald-coffee-co"/);
  assert.match(profile, /data-business-view="weald-coffee-co"/);
  assert.match(profile, /data-business-click="weald-coffee-co"/);
  assert.match(directory, /href="https:\/\/weald\.example"/);
  assert.equal(directory.includes("nofollow"), false);
});
