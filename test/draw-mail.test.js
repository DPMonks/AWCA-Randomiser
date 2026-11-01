import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { ensureMonthlyDraw } from "../lib/lottery.js";
import { copyMail, mailMode, notifyCopyEmails, settleDrawMail, winnerMail } from "../lib/mail.js";
import { manualMemberId } from "../lib/manual-entrants.js";
import { MOCK_KNOWN_EMAILS } from "../lib/mock.js";
import { displayEntryRef } from "../lib/privacy.js";
import { insertMailClaim, mailClaimCollectionSpec, mailClaimId, readMailClaim, removeMailClaim } from "../lib/wix.js";

const savedEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}

test("winner and committee notes say the prize, month, and entry code", () => {
  const winner = winnerMail({ monthLabel: "November 2026", entryRef: "AB12CD", potLabel: "£5.00" });
  const copy = copyMail({
    monthLabel: "November 2026",
    name: "Aaron Example",
    initials: "A.E.",
    email: "test1@example.com",
    entryRef: "AB12CD",
    potLabel: "£5.00",
    month: "2026-11",
  });
  assert.match(winner.subject, /November 2026/);
  assert.match(winner.text, /Congratulations/);
  assert.match(winner.text, /£5\.00/);
  assert.match(winner.text, /November 2026/);
  assert.match(winner.text, /AB12CD/);
  assert.match(winner.text, /AWCA will be in touch/);
  assert.equal(winner.text.includes("test1@example.com"), false);
  assert.equal(winner.text.includes("test2@example.com"), false);
  assert.match(copy.text, /Aaron Example/);
  assert.match(copy.text, /A\.E\./);
  assert.match(copy.text, /test1@example.com/);
  assert.match(copy.text, /AB12CD/);
  assert.match(copy.text, /£5\.00/);
  assert.match(copy.text, /2026-11/);
  assert.equal(copy.text.includes("test2@example.com"), false);
  for (const text of [winner.subject, winner.text, copy.subject, copy.text]) {
    assert.equal(text.includes("\u2013"), false);
    assert.equal(text.includes("\u2014"), false);
  }
  assert.deepEqual(notifyCopyEmails(), [
    "secretary@alconbury-weald.org",
    "community-association@alconbury-weald.org",
  ]);
});

test("mail stays off until production sets EMAIL_ENABLED, and dry runs redirect", async () => {
  delete process.env.VERCEL_ENV;
  delete process.env.EMAIL_ENABLED;
  delete process.env.EMAIL_DRY_RUN;
  assert.equal(mailMode(), "off");
  process.env.EMAIL_ENABLED = "true";
  assert.equal(mailMode(), "live");
  process.env.EMAIL_DRY_RUN = "true";
  assert.equal(mailMode(), "dry");
  process.env.VERCEL_ENV = "preview";
  delete process.env.EMAIL_DRY_RUN;
  process.env.EMAIL_ENABLED = "true";
  assert.equal(mailMode(), "dry");
  const skipped = await settleDrawMail({
    record: { month: "2026-11", entryRef: "AB12CD", potAmount: 1.25, memberId: "member-1", initials: "A.E." },
    members: [{ memberId: "member-1", entryNumber: 1, email: "test1@example.com", name: "Aaron Example" }],
  });
  assert.equal(skipped.skipped, "deployment");
  restoreEnv();
});

test("a draw emails each recipient once, retries only failures, and can dry-run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awca-mail-"));
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(" "));
  process.env.WIX_MOCK = "1";
  process.env.MOCK_DRAW_FILE = join(dir, "draws.json");
  process.env.VERCEL_ENV = "production";
  process.env.EMAIL_ENABLED = "true";
  delete process.env.EMAIL_DRY_RUN;
  delete process.env.WIX_API_KEY;
  delete process.env.WIX_SITE_ID;
  process.env.ENTRY_REF_SECRET = "committee-secret";
  process.env.ADMIN_PASSWORD = "committee-secret";
  process.env.EMAIL_FROM = "AWCA Lottery <lottery@example.com>";
  process.env.RESEND_API_KEY = "test-key";
  process.env.TEST_EMAIL_TO = "inbox@example.com";

  const calls = [];
  let failSecretary = true;
  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (failSecretary && body.to[0] === "secretary@alconbury-weald.org") {
      return new Response("no", { status: 502 });
    }
    return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
  };

  try {
    const when = new Date("2026-11-01T20:00:00.000Z");
    const drawn = await ensureMonthlyDraw({ now: when, randomIntFn: () => 0 });
    assert.equal(drawn.created, true);
    assert.equal(drawn.record.month, "2026-11");
    const winnerAddress = MOCK_KNOWN_EMAILS[drawn.record.memberId];
    assert.equal(calls.length, 3);
    const winner = calls.find((call) => call.to[0] === winnerAddress);
    const secretary = calls.find((call) => call.to[0] === "secretary@alconbury-weald.org");
    const association = calls.find((call) => call.to[0] === "community-association@alconbury-weald.org");
    assert.ok(winner);
    assert.ok(secretary);
    assert.ok(association);
    assert.match(winner.subject, /^AWCA Lottery winner for November 2026$/);
    assert.match(winner.text, /Congratulations/);
    assert.match(winner.text, new RegExp(drawn.record.entryRef));
    assert.match(winner.text, /£/);
    assert.match(winner.text, /AWCA will be in touch/);
    for (const address of Object.values(MOCK_KNOWN_EMAILS)) {
      if (address === winnerAddress) continue;
      assert.equal(winner.text.includes(address), false);
      assert.equal(winner.subject.includes(address), false);
    }
    assert.equal(association.text.includes(winnerAddress), true);
    assert.match(association.text, /November 2026|2026-11/);
    assert.match(association.text, new RegExp(drawn.record.entryRef));
    assert.equal(JSON.stringify(drawn.record).includes(winnerAddress), false);

    const beforeRetry = calls.length;
    const retry = await ensureMonthlyDraw({ now: when });
    assert.equal(retry.created, false);
    assert.equal(retry.record.entryRef, drawn.record.entryRef);
    assert.equal(calls.length, beforeRetry + 1);
    assert.equal(calls.at(-1).to[0], "secretary@alconbury-weald.org");

    failSecretary = false;
    const repaired = await ensureMonthlyDraw({ now: when });
    assert.equal(repaired.created, false);
    assert.equal(calls.length, beforeRetry + 2);
    assert.equal(calls.at(-1).to[0], "secretary@alconbury-weald.org");
    const settled = await ensureMonthlyDraw({ now: when });
    assert.equal(settled.created, false);
    assert.equal(calls.length, beforeRetry + 2);

    calls.length = 0;
    process.env.EMAIL_DRY_RUN = "true";
    const dryDir = await mkdtemp(join(tmpdir(), "awca-mail-dry-"));
    process.env.MOCK_DRAW_FILE = join(dryDir, "draws.json");
    const dry = await ensureMonthlyDraw({ now: new Date("2026-12-01T20:00:00.000Z"), randomIntFn: () => 0 });
    assert.equal(dry.created, true);
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.deepEqual(call.to, ["inbox@example.com"]);
      assert.match(call.subject, /^\[TEST\] /);
    }
    assert.equal(calls.some((call) => call.text.includes("Congratulations")), true);
    assert.equal(calls.some((call) => call.subject.includes("result")), true);
    const realAddresses = [...Object.values(MOCK_KNOWN_EMAILS), "secretary@alconbury-weald.org", "community-association@alconbury-weald.org"];
    for (const call of calls) {
      for (const address of realAddresses) assert.notEqual(call.to[0], address);
    }

    calls.length = 0;
    delete process.env.EMAIL_DRY_RUN;
    delete process.env.EMAIL_ENABLED;
    const offDir = await mkdtemp(join(tmpdir(), "awca-mail-off-"));
    process.env.MOCK_DRAW_FILE = join(offDir, "draws.json");
    const held = await ensureMonthlyDraw({ now: new Date("2027-02-01T20:00:00.000Z"), randomIntFn: () => 0 });
    assert.equal(held.created, true);
    assert.equal(calls.length, 0);

    process.env.VERCEL_ENV = "preview";
    process.env.EMAIL_ENABLED = "true";
    delete process.env.EMAIL_DRY_RUN;
    const previewDir = await mkdtemp(join(tmpdir(), "awca-mail-preview-"));
    process.env.MOCK_DRAW_FILE = join(previewDir, "draws.json");
    calls.length = 0;
    const preview = await ensureMonthlyDraw({ now: new Date("2027-03-01T20:00:00.000Z"), randomIntFn: () => 0 });
    assert.equal(preview.created, true);
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.deepEqual(call.to, ["inbox@example.com"]);
      assert.match(call.subject, /^\[TEST\] /);
    }
    assert.equal(logs.join("\n").includes("@"), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    restoreEnv();
  }
});

test("a manual winner is mailed from the private address on that entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awca-mail-manual-"));
  const originalFetch = globalThis.fetch;
  process.env.WIX_MOCK = "1";
  process.env.MOCK_DRAW_FILE = join(dir, "draws.json");
  process.env.VERCEL_ENV = "production";
  process.env.EMAIL_ENABLED = "true";
  delete process.env.EMAIL_DRY_RUN;
  process.env.ENTRY_REF_SECRET = "committee-secret";
  process.env.EMAIL_FROM = "AWCA Lottery <lottery@example.com>";
  process.env.RESEND_API_KEY = "test-key";
  const memberId = manualMemberId("test1@example.com");
  const entryRef = displayEntryRef(memberId, 1);
  await writeFile(
    process.env.MOCK_DRAW_FILE,
    JSON.stringify({
      extra: [
        {
          memberId,
          initials: "A.E.",
          entryRef,
          month: "2026-11",
          drawnAt: "2026-11-01T20:00:00.000Z",
          entryCount: 2,
          potAmount: 2.5,
        },
      ],
    }),
    "utf8"
  );
  const calls = [];
  globalThis.fetch = async (_url, options = {}) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
  };
  try {
    const result = await settleDrawMail({
      record: { month: "2026-11" },
      members: [
        {
          memberId,
          entryNumber: 1,
          name: "Aaron Example",
          email: "test1@example.com",
          source: "manual",
        },
      ],
    });
    assert.equal(result.sent, 3);
    const winner = calls.find((call) => call.to[0] === "test1@example.com");
    assert.ok(winner);
    assert.match(winner.text, /Congratulations/);
    assert.match(winner.text, /£2\.50/);
    assert.match(winner.text, new RegExp(entryRef));
    assert.equal(winner.text.includes("test2@example.com"), false);
    const copy = calls.find((call) => call.to[0] === "secretary@alconbury-weald.org");
    assert.match(copy.text, /test1@example.com/);
    assert.match(copy.text, /Aaron Example/);
    assert.match(copy.text, /A\.E\./);
    const again = await settleDrawMail({
      record: { month: "2026-11" },
      members: [{ memberId, entryNumber: 1, name: "Aaron Example", email: "test1@example.com" }],
    });
    assert.equal(again.sent, 0);
    assert.equal(calls.length, 3);
    const stored = JSON.parse(await readFile(process.env.MOCK_DRAW_FILE, "utf8"));
    assert.equal(stored.extra[0].emailSent, undefined);
    assert.equal(stored.claims.length, 3);
    assert.equal(stored.claims.every((row) => row.status === "sent"), true);
    assert.equal(JSON.stringify(stored.claims).includes("@"), false);
    assert.equal(JSON.stringify(stored.claims).includes("test1@example.com"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("a duplicate mail claim id is not owned, and a sent claim is not removed", async () => {
  delete process.env.WIX_MOCK;
  delete process.env.VERCEL_ENV;
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "site";
  const originalFetch = globalThis.fetch;
  const spec = mailClaimCollectionSpec();
  assert.equal(spec.permissions.read, "ADMIN");
  assert.equal(spec.permissions.insert, "ADMIN");
  assert.equal(spec.permissions.update, "ADMIN");
  assert.equal(spec.permissions.remove, "ADMIN");
  const id = mailClaimId("2026-11", "winner", "abc123abc123abcd", "live");
  const seen = new Set();
  let created = null;
  let deleted = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    const method = options.method || "GET";
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (path.includes("/wix-data/v2/collections") && method === "POST") {
      created = JSON.parse(options.body).collection;
      return json({});
    }
    if (path.endsWith("/wix-data/v2/items") && method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.dataCollectionId, "LotteryMailClaims");
      if (!created && seen.size === 0) {
        return json({ message: "WDE0025: Collection LotteryMailClaims does not exist" }, 404);
      }
      if (seen.has(body.dataItem.id)) {
        return json({ message: "WDE0073: Item already exists" }, 409);
      }
      seen.add(body.dataItem.id);
      return json({ dataItem: body.dataItem });
    }
    if (method === "GET" && path.includes("/wix-data/v2/items/")) {
      const itemId = decodeURIComponent(path.split("/items/")[1].split("?")[0]);
      if (!seen.has(itemId)) return json({ message: "not found" }, 404);
      return json({
        dataItem: {
          id: itemId,
          data: { month: "2026-11", role: "winner", recipientKey: "abc123abc123abcd", mode: "live", status: "sent", claimedAt: "2026-11-01T20:00:00.000Z", detail: "" },
        },
      });
    }
    if (method === "DELETE") {
      deleted += 1;
      return json({});
    }
    throw new Error(`Unexpected Wix call ${method} ${path}`);
  };
  try {
    const first = await insertMailClaim({
      id,
      month: "2026-11",
      role: "winner",
      key: "abc123abc123abcd",
      mode: "live",
      claimedAt: "2026-11-01T20:00:00.000Z",
    });
    assert.equal(first.inserted, true);
    assert.equal(first.id, id);
    assert.equal(created.id, "LotteryMailClaims");
    assert.equal(created.permissions.read, "ADMIN");
    const second = await insertMailClaim({
      id,
      month: "2026-11",
      role: "winner",
      key: "abc123abc123abcd",
      mode: "live",
      claimedAt: "2026-11-01T20:00:01.000Z",
    });
    assert.equal(second.inserted, false);
    const stored = await readMailClaim(id);
    assert.equal(stored.status, "sent");
    assert.equal(await removeMailClaim(id), false);
    assert.equal(deleted, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("parallel draws send the live notes once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "awca-mail-race-"));
  const originalFetch = globalThis.fetch;
  process.env.WIX_MOCK = "1";
  process.env.MOCK_DRAW_FILE = join(dir, "draws.json");
  process.env.VERCEL_ENV = "production";
  process.env.EMAIL_ENABLED = "true";
  delete process.env.EMAIL_DRY_RUN;
  process.env.ENTRY_REF_SECRET = "committee-secret";
  process.env.EMAIL_FROM = "AWCA Lottery <lottery@example.com>";
  process.env.RESEND_API_KEY = "test-key";
  let sends = 0;
  globalThis.fetch = async () => {
    sends += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
  };
  try {
    const when = new Date("2026-11-01T20:00:00.000Z");
    await Promise.all([
      ensureMonthlyDraw({ now: when, randomIntFn: () => 0 }),
      ensureMonthlyDraw({ now: when, randomIntFn: () => 0 }),
    ]);
    assert.equal(sends, 3);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
