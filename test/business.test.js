import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSupporters,
  cleanBusinessName,
  extractBusinessName,
  extractLogoUrl,
  getBusinessSupporters,
  safeImageUrl,
  selectBusinessPlan,
  unwrapValue,
} from "../lib/business.js";
import { BUSINESS_CACHE_CONTROL, createHandler } from "../api/business-supporters.js";

const PLAN_ID = "b5c65b95-7c1b-4c90-8a5c-761b6ec93978";
const PLANS = [
  { id: "lottery", name: "AWCA Lottery", currency: "GBP", pricingVariants: [{ pricingStrategies: [{ flatRate: { amount: "2.5" } }] }] },
  { id: "community", name: "AWCA Community Membership", currency: "GBP", pricingVariants: [{ pricingStrategies: [{ flatRate: { amount: "4.99" } }] }] },
  { id: PLAN_ID, name: "AWCA Business Membership", currency: "GBP", pricingVariants: [{ pricingStrategies: [{ flatRate: { amount: "9.99" } }] }] },
];

const LOGO = "https://static.wixstatic.com/media/11062b_abc~mv2.png";

function order(overrides = {}) {
  return {
    id: overrides.id || "o1",
    planId: PLAN_ID,
    status: "ACTIVE",
    buyer: { memberId: "m1", contactId: "c1" },
    startDate: "2026-09-01T10:00:00.000Z",
    formData: {
      formId: "f1",
      submissionId: "s1",
      submissionData: {
        first_name: "Jane",
        last_name: "Smith",
        email: "jane@example.com",
        business_name: "Weald Coffee Co",
        business_logo: [{ fileId: "x", displayName: "logo.png", url: LOGO, fileType: "IMAGE" }],
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

test("selectBusinessPlan picks the 9.99 Business Membership plan", () => {
  assert.deepEqual(selectBusinessPlan(PLANS), { id: PLAN_ID, name: "AWCA Business Membership" });
  assert.equal(selectBusinessPlan(PLANS, "configured").id, "configured");
  assert.equal(selectBusinessPlan([PLANS[0]]), null);
});

test("extracts business name and logo from order form data", () => {
  const data = order().formData.submissionData;
  assert.equal(extractBusinessName(data), "Weald Coffee Co");
  assert.equal(extractLogoUrl(data), LOGO);
});

test("honours explicit field keys", () => {
  const data = { field_a: "Acme Ltd", field_b: [{ url: LOGO }], company_note: "ignore me" };
  assert.equal(extractBusinessName(data, "field_a"), "Acme Ltd");
  assert.equal(extractLogoUrl(data, "field_b"), LOGO);
  assert.equal(extractLogoUrl(data, "missing"), "");
});

test("reads protobuf style Value wrappers", () => {
  const data = {
    business_name: { stringValue: "Wrapped Ltd" },
    logo: { listValue: { values: [{ structValue: { fields: { url: { stringValue: LOGO } } } }] } },
  };
  assert.deepEqual(unwrapValue({ stringValue: "a" }), "a");
  assert.equal(extractBusinessName(data), "Wrapped Ltd");
  assert.equal(extractLogoUrl(data), LOGO);
});

test("converts wix:image URIs and rejects unsafe logo URLs", () => {
  assert.equal(safeImageUrl("wix:image://v1/11062b_abc~mv2.png/logo.png#originWidth=10"), "https://static.wixstatic.com/media/11062b_abc~mv2.png");
  assert.equal(safeImageUrl("http://static.wixstatic.com/media/a.png"), "");
  assert.equal(safeImageUrl("https://evil.example.com/a.png"), "");
  assert.equal(safeImageUrl("javascript:alert(1)"), "");
  assert.equal(safeImageUrl("https://abc123.usrfiles.com/ugd/logo.png"), "https://abc123.usrfiles.com/ugd/logo.png");
});

test("cleanBusinessName trims, replaces long dashes and rejects emails", () => {
  assert.equal(cleanBusinessName("  Smith \u2014 Sons  "), "Smith - Sons");
  assert.equal(cleanBusinessName("a@b.com"), "");
  assert.equal(cleanBusinessName("<b>Bold</b>"), "bBold/b");
  assert.equal(cleanBusinessName("x".repeat(200)).length, 80);
  assert.equal(cleanBusinessName(42), "");
});

test("buildSupporters keeps active orders only and exposes name and logo only", () => {
  const supporters = buildSupporters([
    order(),
    order({ id: "o2", status: "CANCELED", buyer: { memberId: "m2" } }),
    order({ id: "o3", status: "ENDED", buyer: { memberId: "m3" } }),
    order({ id: "o4", planId: "other", buyer: { memberId: "m4" } }),
    order({ id: "o5", buyer: { memberId: "m5" }, formData: { submissionData: { business_name: "Alconbury Garden Services" } } }),
    order({ id: "o6", buyer: { memberId: "m6" }, formData: { submissionData: { first_name: "No business" } } }),
  ], { planId: PLAN_ID });
  assert.deepEqual(supporters, [
    { name: "Alconbury Garden Services", logoUrl: null },
    { name: "Weald Coffee Co", logoUrl: LOGO },
  ]);
  const json = JSON.stringify(supporters);
  assert.ok(!json.includes("Jane"));
  assert.ok(!json.includes("jane@example.com"));
  assert.ok(!json.includes("m1"));
});

test("buildSupporters uses the newest order per buyer and dedupes names", () => {
  const older = order({ id: "old", startDate: "2026-01-01T00:00:00.000Z", formData: { submissionData: { business_name: "Old Name" } } });
  const newer = order({ id: "new", startDate: "2026-09-01T00:00:00.000Z", formData: { submissionData: { business_name: "New Name" } } });
  const twin = order({ id: "twin", buyer: { memberId: "m9" }, formData: { submissionData: { business_name: "new name" } } });
  assert.deepEqual(buildSupporters([older, newer, twin], { planId: PLAN_ID }).map((s) => s.name), ["New Name"]);
});

test("getBusinessSupporters returns an empty list when there are no orders", async () => {
  const body = await getBusinessSupporters({ listPlans: async () => PLANS, listOrdersForPlan: async () => [] }, {});
  assert.deepEqual(body, { available: true, supporters: [] });
});

test("API returns supporters with a 5 minute CDN cache", async () => {
  let askedFor = "";
  const handler = createHandler({
    listPlans: async () => PLANS,
    listOrdersForPlan: async (id) => { askedFor = id; return [order()]; },
  });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(askedFor, PLAN_ID);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], BUSINESS_CACHE_CONTROL);
  assert.deepEqual(JSON.parse(res.body), { available: true, supporters: [{ name: "Weald Coffee Co", logoUrl: LOGO }] });
});

test("API degrades gracefully when Wix fails and rejects non GET", async () => {
  const handler = createHandler({ listPlans: async () => { throw new Error("boom"); }, listOrdersForPlan: async () => [] });
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(res.body), { available: false, supporters: [] });
  const post = mockRes();
  await handler({ method: "POST" }, post);
  assert.equal(post.statusCode, 405);
});

test("business embed can be framed by Wix and nothing else is opened up", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const deny = config.headers.find((h) => h.source.startsWith("/((?!"));
  assert.ok(deny.source.includes("business-embed"));
  assert.ok(deny.source.includes("winners-embed"));
  for (const source of ["/business-embed", "/business-embed/(.*)"]) {
    const rule = config.headers.find((h) => h.source === source);
    assert.ok(rule, source);
    const csp = rule.headers.find((h) => h.key === "Content-Security-Policy").value;
    assert.match(csp, /frame-ancestors https:\/\/www\.alconbury-weald\.org/);
    assert.match(csp, /https:\/\/\*\.wix\.com/);
  }
});

test("business embed copy has the empty state and no long dashes", () => {
  const html = readFileSync(new URL("../public/business-embed/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("Become our first business supporter"));
  assert.ok(html.includes("/api/business-supporters"));
  assert.ok(!/[\u2013\u2014]/.test(html));
});
