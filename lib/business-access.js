// Whether a Wix business order should be on the public site right now.
// Active memberships stay up. Paused, expired, and failed payments come down.
// Cancel at period end stays up until the paid period ends, then comes down.

function timeOf(value) {
  if (value == null || value === "") return null;
  const time = Date.parse(String(value));
  return Number.isNaN(time) ? null : time;
}

export function cycleEnd(order) {
  const cycle = order?.currentCycle;
  if (!cycle || typeof cycle !== "object") return null;
  return timeOf(cycle.endedDate) ?? timeOf(cycle.endDate) ?? timeOf(cycle.endsAt);
}

export function subscriptionEnd(order) {
  return timeOf(order?.endDate) ?? timeOf(order?.earliestEndDate);
}

export function paymentFailed(order) {
  const payment = String(order?.lastPaymentStatus || order?.paymentStatus || "").toUpperCase();
  if (payment === "FAILED" || payment === "PAYMENT_FAILED" || payment === "CHARGE_FAILED") return true;
  const cause = String(order?.cancellation?.cause || "").toUpperCase();
  return cause.includes("PAYMENT_FAILED") || cause.includes("PAYMENT_SETUP_FAILED");
}

export function cancelsAtPeriodEnd(order) {
  const effective = String(order?.cancellation?.effectiveAt || "").toUpperCase();
  if (effective === "IMMEDIATELY") return false;
  if (effective === "NEXT_PAYMENT_DATE") return true;
  return Boolean(order?.autoRenewCanceled);
}

function canceledStatus(status) {
  return status === "CANCELED" || status === "CANCELLED";
}

// When access actually stops. A renewing plan uses the subscription end date.
// A cycle end on its own is the next renewal, not an expiry, while Wix still
// says the order is active. Cancel at period end stops at the earlier date.
export function accessEndsAt(order) {
  const cycle = cycleEnd(order);
  const end = subscriptionEnd(order);
  const status = String(order?.status || "").toUpperCase();
  const stopping = cancelsAtPeriodEnd(order) || canceledStatus(status);
  if (stopping) {
    if (cycle != null && end != null) return Math.min(cycle, end);
    return cycle ?? end;
  }
  return end;
}

export function isBusinessDisplayed(order, now = Date.now()) {
  if (!order || typeof order !== "object") return false;
  const status = String(order.status || "").toUpperCase();
  if (!status || paymentFailed(order)) return false;
  if (status === "PAUSED" || status === "ENDED" || status === "PENDING" || status === "DRAFT" || status === "SUSPENDED") {
    return false;
  }
  const until = accessEndsAt(order);
  const stillPaid = until == null || now < until;
  if (canceledStatus(status)) {
    const immediate = String(order?.cancellation?.effectiveAt || "").toUpperCase() === "IMMEDIATELY";
    if (immediate || until == null) return false;
    return now < until;
  }
  if (status !== "ACTIVE") return false;
  return stillPaid;
}

export function businessStatusLabel(order, now = Date.now()) {
  if (paymentFailed(order)) return "Payment failed";
  const status = String(order?.status || "").toUpperCase();
  if (status === "PAUSED") return "Paused";
  if (status === "ENDED") return "Ended";
  if (status === "PENDING") return "Pending";
  if (status === "DRAFT") return "Draft";
  if (status === "SUSPENDED") return "Suspended";
  if (canceledStatus(status)) {
    return isBusinessDisplayed(order, now) ? "Cancelled, paid until period end" : "Cancelled";
  }
  if (status === "ACTIVE") {
    const until = accessEndsAt(order);
    if (until != null && now >= until) return cancelsAtPeriodEnd(order) ? "Cancelled" : "Ended";
    if (cancelsAtPeriodEnd(order)) return "Active, cancels at period end";
    return "Active";
  }
  return "Not active";
}

export function renewalSchedule(order) {
  const cycle = cycleEnd(order);
  const end = subscriptionEnd(order);
  const status = String(order?.status || "").toUpperCase();
  const stopping = cancelsAtPeriodEnd(order) || canceledStatus(status) || status === "ENDED";
  if (stopping) {
    const until = accessEndsAt(order);
    return { endDate: until == null ? null : new Date(until).toISOString(), endNote: until == null ? "" : "Paid until" };
  }
  if (cycle != null) return { endDate: new Date(cycle).toISOString(), endNote: "Next renewal" };
  if (end != null) return { endDate: new Date(end).toISOString(), endNote: "Paid until" };
  return { endDate: null, endNote: "" };
}
