import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BUSINESS_CACHE_CONTROL } from "../api/business-supporters.js";
import { createHandler } from "../api/business-spotlight.js";
import { londonDateKey, spotlightOrder, spotlightSlots, PRICING_URL, PLACEHOLDER_LABEL } from "../lib/spotlight.js";

const FRAME = "frame-ancestors https://www.alconbury-weald.org https://alconbury-weald.org https://*.wix.com https://*.wixsite.com https://*.filesusr.com https://*.wixstatic.com";
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];

function supporters() {
  return NAMES.map((name) => ({ name, slug: name.toLowerCase(), logoUrl: null }));
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

test("the spotlight date follows midnight in London", () => {
  assert.equal(londonDateKey("2026-05-31T22:59:59.999Z"), "2026-05-31");
  assert.equal(londonDateKey("2026-05-31T23:00:00.000Z"), "2026-06-01");
  assert.equal(londonDateKey("2026-06-01T22:59:00.000Z"), "2026-06-01");
  assert.equal(londonDateKey("2026-06-01T23:00:00.000Z"), "2026-06-02");
  assert.equal(londonDateKey("2026-11-30T23:59:59.999Z"), "2026-11-30");
  assert.equal(londonDateKey("2026-12-01T00:00:00.000Z"), "2026-12-01");
});

test("the daily pick is a seeded shuffle and changes at London midnight", () => {
  const list = supporters();
  const morning = new Date("2026-06-01T10:00:00.000Z");
  const evening = new Date("2026-06-01T22:59:00.000Z");
  const nextDay = new Date("2026-06-01T23:00:00.000Z");
  const first = spotlightOrder(list, morning);
  const second = spotlightOrder(list, evening);
  assert.equal(first.date, "2026-06-01");
  assert.deepEqual(first.supporters.map((item) => item.slug), second.supporters.map((item) => item.slug));
  assert.deepEqual(first.supporters.map((item) => item.slug), [
    "alpha", "delta", "echo", "charlie", "bravo", "foxtrot",
  ]);
  assert.deepEqual(spotlightOrder(list, nextDay).supporters.map((item) => item.slug), [
    "delta", "echo", "bravo", "alpha", "charlie", "foxtrot",
  ]);
  const slots = spotlightSlots(list, morning);
  assert.equal(slots.slots.length, 4);
  assert.deepEqual(slots.slots.map((slot) => slot.slug), ["alpha", "delta", "echo", "charlie"]);
});

test("fewer than four businesses are filled with pricing placeholders", () => {
  const slots = spotlightSlots(supporters().slice(0, 1), new Date("2026-06-01T12:00:00.000Z"));
  assert.equal(slots.slots.length, 4);
  assert.equal(slots.slots[0].kind, "business");
  assert.equal(slots.slots.filter((slot) => slot.kind === "placeholder").length, 3);
  assert.equal(slots.slots[1].label, PLACEHOLDER_LABEL);
  assert.equal(slots.slots[1].href, PRICING_URL);
  const empty = spotlightSlots([], new Date("2026-06-01T12:00:00.000Z"));
  assert.equal(empty.slots.every((slot) => slot.kind === "placeholder"), true);
});

test("the spotlight API is cached for five minutes and degrades to placeholders", async () => {
  const plans = [{ id: "biz", name: "AWCA Business Membership" }];
  const handler = createHandler({
    listPlans: async () => plans,
    listOrdersForPlan: async () => [{
      id: "o1",
      planId: "biz",
      status: "ACTIVE",
      buyer: { memberId: "m1" },
      startDate: "2026-01-01T00:00:00.000Z",
      formData: { submissionData: { business_name: "Alpha" } },
    }],
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], BUSINESS_CACHE_CONTROL);
  assert.match(res.headers["cache-control"], /s-maxage=300/);
  assert.match(res.headers["cache-control"], /stale-while-revalidate=0/);
  const body = JSON.parse(res.body);
  assert.equal(body.slots.filter((slot) => slot.kind === "business").length, 1);
  assert.equal(body.slots.length, 4);

  const down = createHandler({
    listPlans: async () => { throw new Error("boom"); },
    listOrdersForPlan: async () => [],
  });
  const failed = mockRes();
  await down({ method: "GET" }, failed);
  assert.equal(failed.statusCode, 200);
  assert.equal(failed.headers["cache-control"], "no-store");
  assert.equal(JSON.parse(failed.body).slots.length, 4);
  const post = mockRes();
  await handler({ method: "POST" }, post);
  assert.equal(post.statusCode, 405);
});

test("the spotlight embed matches the business embed frame rules", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const html = readFileSync(new URL("../public/business-spotlight/index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/business-spotlight.js", import.meta.url), "utf8");
  const home = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const deny = config.headers.find((rule) => rule.source.startsWith("/((?!"));
  assert.ok(deny.source.includes("business-spotlight"));
  const denyCsp = deny.headers.find((header) => header.key === "Content-Security-Policy").value;
  assert.match(denyCsp, /https:\/\/static\.wixstatic\.com/);
  for (const source of ["/business-spotlight", "/business-spotlight/(.*)"]) {
    const rule = config.headers.find((item) => item.source === source);
    assert.equal(rule.headers.some((header) => header.key === "X-Frame-Options"), false, source);
    const csp = rule.headers.find((header) => header.key === "Content-Security-Policy").value;
    assert.equal(csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("frame-ancestors")), FRAME);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(csp, /https:\/\/\*\.wixmp\.com/);
  }
  assert.match(html, /#4f5139/);
  assert.match(html, /#f4f1e6/);
  assert.match(html, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(html, /@media \(max-width: 640px\)/);
  assert.match(html, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /aspect-ratio: 1/);
  assert.match(html, /<script src="\/biz-beacon\.js"><\/script>/);
  assert.match(html, /<script src="\/business-spotlight\.js"><\/script>/);
  assert.match(script, /target = "_blank"/);
  assert.match(script, /data-business-click/);
  assert.match(script, /data-business-view/);
  assert.match(script, /Your business here/);
  assert.match(script, /pricing-plans\/plans-pricing/);
  assert.match(home, /This month's draw is supported by/);
  assert.match(main, /\/api\/business-spotlight/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  const hashes = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    if (match[1]) hashes.push(createHash("sha256").update(match[1], "utf8").digest("base64"));
  }
  assert.deepEqual(hashes, []);
});
