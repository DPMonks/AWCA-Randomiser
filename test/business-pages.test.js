import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSupporters } from "../lib/business.js";
import { BUSINESS_CACHE_CONTROL } from "../api/business-supporters.js";
import { createHandler as createDirectoryHandler } from "../api/business-directory.js";
import { createHandler as createSitemapHandler } from "../api/sitemap.js";
import {
  MEMBERSHIP_URL,
  SITE_ORIGIN,
  businessPageTitle,
  renderBusinessPage,
  renderDirectoryPage,
  renderSitemap,
} from "../lib/business-pages.js";

const PLAN_ID = "b5c65b95-7c1b-4c90-8a5c-761b6ec93978";
const PLANS = [
  { id: PLAN_ID, name: "AWCA Business Membership", currency: "GBP", pricingVariants: [{ pricingStrategies: [{ flatRate: { amount: "9.99" } }] }] },
];
const LOGO = "https://static.wixstatic.com/media/11062b_abc~mv2.png";
const EMAIL = "jane.private@example.com";
const BUSINESS_EMAIL = "owner.private@weald.example";

function order(overrides = {}) {
  return {
    id: overrides.id || "o1",
    planId: PLAN_ID,
    status: "ACTIVE",
    buyer: { memberId: "member-private-1", contactId: "contact-private-1" },
    startDate: "2026-09-01T10:00:00.000Z",
    formData: {
      submissionData: {
        first_name: "Jane",
        last_name: "Smith",
        email: EMAIL,
        business_email: BUSINESS_EMAIL,
        business_name: "Weald Coffee Co",
        company_website: "HTTPS://Weald.Example/menu/",
        business_logo: [{ url: LOGO }],
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

function deps(orders) {
  return {
    listPlans: async () => PLANS,
    listOrdersForPlan: async () => orders,
  };
}

function jsonLd(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "json-ld missing");
  return JSON.parse(match[1]);
}

test("a business page is server HTML with SEO tags, schema, and no private data", () => {
  const [supporter] = buildSupporters([order()], { planId: PLAN_ID });
  const html = renderBusinessPage({ ...supporter, email: EMAIL, memberId: "member-private-1", first_name: "Jane" });
  assert.match(html, /<script src="\/biz-beacon\.js"><\/script>/);
  assert.equal(html.replace('<script src="/biz-beacon.js"></script>', "").includes("<script src="), false);
  assert.match(html, /<title>Weald Coffee Co \| Alconbury Weald business supporter<\/title>/);
  assert.equal(businessPageTitle(supporter.name), "Weald Coffee Co | Alconbury Weald business supporter");
  assert.match(html, /<meta name="description" content="Weald Coffee Co is an AWCA Business Membership supporter in Alconbury Weald, Huntingdon, Cambridgeshire\." \/>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/lottery\.alconbury-weald\.org\/businesses\/weald-coffee-co" \/>/);
  assert.match(html, /<meta name="robots" content="index, follow" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/static\.wixstatic\.com\/media\/11062b_abc~mv2\.png" \/>/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/static\.wixstatic\.com\/media\/11062b_abc~mv2\.png" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(html, new RegExp(`href="${MEMBERSHIP_URL}"`));
  assert.match(html, /class="website-link" href="https:\/\/weald\.example\/menu\/"/);
  assert.equal(html.includes("nofollow"), false);
  assert.equal(html.includes(EMAIL), false);
  assert.equal(html.includes(BUSINESS_EMAIL), false);
  assert.equal(html.includes("Jane"), false);
  assert.equal(html.includes("member-private-1"), false);
  assert.match(html, /#4f5139/);
  assert.match(html, /#f4f1e6/);
  const schema = jsonLd(html);
  assert.equal(schema["@type"], "LocalBusiness");
  assert.equal(schema.name, "Weald Coffee Co");
  assert.equal(schema.logo, LOGO);
  assert.equal(schema.url, "https://weald.example/menu/");
  assert.equal(schema.sameAs, "https://weald.example/menu/");
  assert.deepEqual(schema.areaServed, ["Alconbury Weald", "Huntingdon", "Cambridgeshire"]);
  assert.equal(JSON.stringify(schema).includes(EMAIL), false);
});

test("the directory lists every supporter and omits email", () => {
  const supporters = buildSupporters([
    order(),
    order({
      id: "o2",
      buyer: { memberId: "member-private-2" },
      formData: {
        submissionData: {
          email: "gardener@example.com",
          business_name: "Alconbury Garden Services",
        },
      },
    }),
  ], { planId: PLAN_ID });
  const html = renderDirectoryPage(supporters);
  assert.match(html, /<title>Business supporters \| Alconbury Weald<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/lottery\.alconbury-weald\.org\/businesses" \/>/);
  assert.match(html, /href="\/businesses\/alconbury-garden-services"/);
  assert.match(html, /href="\/businesses\/weald-coffee-co"/);
  assert.match(html, /href="https:\/\/weald\.example\/menu\/"/);
  assert.equal(html.includes("nofollow"), false);
  assert.equal(html.includes(EMAIL), false);
  assert.equal(html.includes("gardener@example.com"), false);
  assert.equal(html.includes("noindex"), false);
  assert.equal(jsonLd(html)["@type"], "CollectionPage");
});

test("sitemap lists the home page, the directory, and each business with lastmod", () => {
  const supporters = buildSupporters([order()], { planId: PLAN_ID });
  const xml = renderSitemap(supporters);
  assert.match(xml, /<loc>https:\/\/lottery\.alconbury-weald\.org\/<\/loc>\s*<lastmod>2026-09-01<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/lottery\.alconbury-weald\.org\/businesses<\/loc>\s*<lastmod>2026-09-01<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/lottery\.alconbury-weald\.org\/businesses\/weald-coffee-co<\/loc>\s*<lastmod>2026-09-01<\/lastmod>/);
  assert.equal(xml.includes(EMAIL), false);
  assert.equal(xml.includes(BUSINESS_EMAIL), false);
  assert.equal(SITE_ORIGIN, "https://lottery.alconbury-weald.org");
});

test("unknown business slugs return 404 and known slugs are cached HTML", async () => {
  const handler = createDirectoryHandler(deps([order()]));
  const missing = mockRes();
  await handler({ method: "GET", query: { slug: "no-such-business" } }, missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.headers["cache-control"], "no-store");
  assert.match(missing.headers["x-robots-tag"], /noindex/);
  assert.match(missing.body, /Business not found/);
  assert.equal(missing.body.includes(EMAIL), false);
  assert.equal(missing.body.includes("Weald Coffee Co"), false);

  const found = mockRes();
  await handler({ method: "GET", url: "/businesses/weald-coffee-co" }, found);
  assert.equal(found.statusCode, 200);
  assert.equal(found.headers["cache-control"], BUSINESS_CACHE_CONTROL);
  assert.match(found.headers["cache-control"], /s-maxage=300/);
  assert.match(found.headers["cache-control"], /stale-while-revalidate/);
  assert.equal(found.headers["x-robots-tag"], "index, follow");
  assert.equal(found.headers["content-type"], "text/html; charset=utf-8");
  assert.match(found.body, /Weald Coffee Co \| Alconbury Weald business supporter/);
  assert.equal(found.body.includes(EMAIL), false);

  const directory = mockRes();
  await handler({ method: "GET", query: {} }, directory);
  assert.equal(directory.statusCode, 200);
  assert.match(directory.body, /Business supporters \| Alconbury Weald/);
  assert.equal(directory.headers["cache-control"], BUSINESS_CACHE_CONTROL);
});

test("sitemap route lists the business page and robots.txt allows crawling", async () => {
  const handler = createSitemapHandler(deps([order()]));
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/xml; charset=utf-8");
  assert.equal(res.headers["cache-control"], BUSINESS_CACHE_CONTROL);
  assert.match(res.body, /https:\/\/lottery\.alconbury-weald\.org\/businesses\/weald-coffee-co/);
  assert.match(res.body, /<lastmod>2026-09-01<\/lastmod>/);
  assert.equal(res.body.includes(EMAIL), false);

  const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Allow: \/businesses$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Disallow: \/admin$/m);
  assert.match(robots, /^Sitemap: https:\/\/lottery\.alconbury-weald\.org\/sitemap\.xml$/m);
  assert.equal(/^Disallow:\s*\/businesses/m.test(robots), false);
  assert.equal(/^Disallow:\s*\/\s*$/m.test(robots), false);
});

test("business pages are routed and their CSP allows logo hosts", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(config.rewrites.some((rule) => rule.source === "/businesses" && rule.destination === "/api/business-directory"));
  assert.ok(config.rewrites.some((rule) => rule.source === "/businesses/:slug" && rule.destination === "/api/business-directory?slug=:slug"));
  assert.ok(config.rewrites.some((rule) => rule.source === "/sitemap.xml" && rule.destination === "/api/sitemap"));
  const deny = config.headers.find((rule) => rule.source.includes("(?!winners-embed)"));
  assert.match(deny.source, /\(\?!businesses\)/);
  for (const source of ["/businesses", "/businesses/(.*)"]) {
    const rule = config.headers.find((item) => item.source === source);
    assert.ok(rule, source);
    const headers = Object.fromEntries(rule.headers.map((header) => [header.key, header.value]));
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["X-Robots-Tag"], undefined);
    const csp = headers["Content-Security-Policy"];
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /https:\/\/static\.wixstatic\.com/);
    assert.match(csp, /https:\/\/\*\.wixstatic\.com/);
    assert.match(csp, /https:\/\/\*\.usrfiles\.com/);
    assert.match(csp, /https:\/\/\*\.wixmp\.com/);
    assert.equal(/noindex/i.test(csp), false);
  }
});
