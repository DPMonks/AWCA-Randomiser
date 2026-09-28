import test from "node:test";
import assert from "node:assert/strict";
import { buildSupporters } from "../lib/business.js";
import {
  accessEndsAt,
  businessStatusLabel,
  isBusinessDisplayed,
  renewalSchedule,
} from "../lib/business-access.js";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const FUTURE = "2026-07-01T00:00:00.000Z";
const PAST = "2026-06-01T00:00:00.000Z";
const EXACT = new Date(NOW).toISOString();
const JUST_AFTER = new Date(NOW + 1).toISOString();
const PLAN_ID = "plan-business";

function order(overrides = {}) {
  return {
    id: "o1",
    planId: PLAN_ID,
    status: "ACTIVE",
    buyer: { memberId: "m1" },
    startDate: "2026-01-01T00:00:00.000Z",
    formData: { submissionData: { business_name: "Weald Coffee Co" } },
    ...overrides,
  };
}

test("an active membership with no dates stays on the site", () => {
  const row = order();
  assert.equal(isBusinessDisplayed(row, NOW), true);
  assert.equal(accessEndsAt(row), null);
  assert.equal(businessStatusLabel(row, NOW), "Active");
});

test("an active membership stays up until the end instant, then comes down", () => {
  assert.equal(isBusinessDisplayed(order({ endDate: FUTURE }), NOW), true);
  assert.equal(isBusinessDisplayed(order({ endDate: PAST }), NOW), false);
  assert.equal(isBusinessDisplayed(order({ endDate: EXACT }), NOW), false);
  assert.equal(isBusinessDisplayed(order({ endDate: JUST_AFTER }), NOW), true);
  assert.equal(businessStatusLabel(order({ endDate: PAST }), NOW), "Ended");
  assert.equal(businessStatusLabel(order({ endDate: FUTURE }), NOW), "Active");
});

test("a renewing member is not removed by a stale cycle end", () => {
  const row = order({
    endDate: FUTURE,
    currentCycle: { endedDate: PAST },
  });
  assert.equal(isBusinessDisplayed(row, NOW), true);
  assert.equal(renewalSchedule(row).endNote, "Next renewal");
  assert.equal(renewalSchedule(row).endDate, new Date(PAST).toISOString());
});

test("cancel at period end stays up through the paid period and then stops", () => {
  const pending = order({
    autoRenewCanceled: true,
    endDate: FUTURE,
    currentCycle: { endDate: FUTURE },
  });
  const finished = order({
    autoRenewCanceled: true,
    cancellation: { effectiveAt: "NEXT_PAYMENT_DATE" },
    endDate: FUTURE,
    currentCycle: { endedDate: PAST },
  });
  assert.equal(isBusinessDisplayed(pending, NOW), true);
  assert.equal(businessStatusLabel(pending, NOW), "Active, cancels at period end");
  assert.equal(renewalSchedule(pending).endNote, "Paid until");
  assert.equal(isBusinessDisplayed(finished, NOW), false);
  assert.equal(businessStatusLabel(finished, NOW), "Cancelled");
  assert.equal(isBusinessDisplayed(order({
    autoRenewCanceled: true,
    currentCycle: { endsAt: EXACT },
  }), NOW), false);
  assert.equal(isBusinessDisplayed(order({
    autoRenewCanceled: true,
    currentCycle: { endsAt: JUST_AFTER },
  }), NOW), true);
});

test("a canceled order stays up only when the paid period has not ended", () => {
  const paid = order({
    status: "CANCELED",
    cancellation: { effectiveAt: "NEXT_PAYMENT_DATE" },
    endDate: FUTURE,
  });
  const over = order({
    status: "CANCELED",
    cancellation: { effectiveAt: "NEXT_PAYMENT_DATE" },
    endDate: PAST,
  });
  const immediate = order({
    status: "CANCELED",
    cancellation: { effectiveAt: "IMMEDIATELY" },
    endDate: FUTURE,
  });
  const undated = order({ status: "CANCELLED" });
  assert.equal(isBusinessDisplayed(paid, NOW), true);
  assert.equal(businessStatusLabel(paid, NOW), "Cancelled, paid until period end");
  assert.equal(isBusinessDisplayed(over, NOW), false);
  assert.equal(businessStatusLabel(over, NOW), "Cancelled");
  assert.equal(isBusinessDisplayed(immediate, NOW), false);
  assert.equal(isBusinessDisplayed(undated, NOW), false);
  assert.equal(isBusinessDisplayed(order({
    status: "CANCELED",
    cancellation: { effectiveAt: "NEXT_PAYMENT_DATE" },
    endDate: EXACT,
  }), NOW), false);
});

test("paused, ended, pending, draft, and suspended orders are hidden", () => {
  for (const status of ["PAUSED", "ENDED", "PENDING", "DRAFT", "SUSPENDED"]) {
    const row = order({ status, endDate: FUTURE });
    assert.equal(isBusinessDisplayed(row, NOW), false, status);
  }
  assert.equal(businessStatusLabel(order({ status: "PAUSED" }), NOW), "Paused");
  assert.equal(businessStatusLabel(order({ status: "ENDED" }), NOW), "Ended");
  assert.equal(businessStatusLabel(order({ status: "PENDING" }), NOW), "Pending");
  assert.equal(businessStatusLabel(order({ status: "DRAFT" }), NOW), "Draft");
  assert.equal(businessStatusLabel(order({ status: "SUSPENDED" }), NOW), "Suspended");
});

test("a failed payment is hidden even while the order still says active", () => {
  for (const lastPaymentStatus of ["FAILED", "PAYMENT_FAILED", "CHARGE_FAILED"]) {
    const row = order({ lastPaymentStatus, endDate: FUTURE });
    assert.equal(isBusinessDisplayed(row, NOW), false, lastPaymentStatus);
    assert.equal(businessStatusLabel(row, NOW), "Payment failed");
  }
  const caused = order({
    cancellation: { cause: "PAYMENT_FAILED" },
    endDate: FUTURE,
  });
  const setup = order({
    paymentStatus: "OK",
    cancellation: { cause: "PAYMENT_SETUP_FAILED" },
  });
  assert.equal(isBusinessDisplayed(caused, NOW), false);
  assert.equal(isBusinessDisplayed(setup, NOW), false);
  const unpaid = order({ lastPaymentStatus: "UNPAID", endDate: FUTURE });
  assert.equal(isBusinessDisplayed(unpaid, NOW), true);
  assert.equal(isBusinessDisplayed(null, NOW), false);
  assert.equal(isBusinessDisplayed({ status: "" }, NOW), false);
});

test("the public list keeps the current order and drops one that has expired", () => {
  const older = order({
    id: "old",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: FUTURE,
    formData: { submissionData: { business_name: "Old Cafe", email: "old@example.com" } },
  });
  const newer = order({
    id: "new",
    startDate: "2026-06-01T00:00:00.000Z",
    endDate: PAST,
    formData: { submissionData: { business_name: "New Cafe", email: "new@example.com" } },
  });
  const paused = order({
    id: "paused",
    buyer: { memberId: "m2" },
    status: "PAUSED",
    endDate: FUTURE,
    formData: { submissionData: { business_name: "Paused Bakery" } },
  });
  const names = buildSupporters([newer, older, paused], { planId: PLAN_ID, now: NOW }).map((row) => row.name);
  assert.deepEqual(names, ["Old Cafe"]);
});
