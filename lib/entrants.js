const STATUS_LABEL = {
  ACTIVE: "Active",
  CANCELED: "Cancelled",
  ENDED: "Ended",
  PAUSED: "Paused",
  PENDING: "Pending",
  DRAFT: "Draft",
};

const STATUS_RANK = {
  ACTIVE: 0,
  PAUSED: 1,
  PENDING: 2,
  CANCELED: 3,
  ENDED: 4,
  DRAFT: 5,
};

export function statusLabel(status) {
  return STATUS_LABEL[status] || "Not active";
}

function endDateFor(order) {
  if (order.status === "CANCELED") {
    return order.cancellation?.requestedDate || order.endDate || null;
  }
  return order.endDate || null;
}

export function isPendingCancellation(order) {
  return Boolean(order?.autoRenewCanceled) && order?.cancellation?.effectiveAt === "NEXT_PAYMENT_DATE";
}

export function excludePendingCancellation() {
  const flag = String(process.env.EXCLUDE_PENDING_CANCELLATION || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function orderTime(order) {
  return String(order.updatedDate || order.createdDate || order.startDate || "");
}

export const EMAIL_UNAVAILABLE = "Email unavailable";

function cleanEmail(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 254) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "";
  return text;
}

function emailFromList(list) {
  if (!Array.isArray(list) || list.length === 0) return "";
  const marked = list.find((item) => {
    if (!item || typeof item !== "object") return false;
    return item.primary === true || String(item.tag || "").toUpperCase() === "MAIN";
  });
  const preferred = cleanEmail(marked?.email || marked?.address);
  if (preferred) return preferred;
  for (const item of list) {
    const email = typeof item === "string" ? cleanEmail(item) : cleanEmail(item?.email || item?.address);
    if (email) return email;
  }
  return "";
}

function emailFromContact(contact) {
  if (!contact || typeof contact !== "object") return "";
  const primary = cleanEmail(contact.primaryInfo?.email)
    || cleanEmail(contact.primaryEmail?.email)
    || cleanEmail(typeof contact.primaryEmail === "string" ? contact.primaryEmail : "");
  if (primary) return primary;
  const nested = contact.info?.emails;
  const items = Array.isArray(nested?.items) ? nested.items : Array.isArray(nested) ? nested : [];
  return emailFromList(contact.emails) || emailFromList(items);
}

export function subscriberEmail(record) {
  if (!record || typeof record !== "object") return "";
  const login = cleanEmail(record.loginEmail);
  if (login) return login;
  return emailFromContact(record.contact) || emailFromContact(record);
}

export function contactIdOf(member) {
  return String(member?.contactId || member?.contact?.contactId || member?.contact?.id || "").trim();
}

export function memberDisplayName(member) {
  const first = member?.contact?.firstName?.trim() || "";
  const last = member?.contact?.lastName?.trim() || "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  const nickname = member?.profile?.nickname?.trim();
  if (nickname) return nickname;
  return "Member";
}

export function buildMembers(orders, namesById = new Map()) {
  const grouped = new Map();
  for (const order of orders || []) {
    const memberId = order?.buyer?.memberId;
    if (!memberId) continue;
    const list = grouped.get(memberId) || [];
    list.push(order);
    grouped.set(memberId, list);
  }

  const members = [];
  for (const [memberId, list] of grouped) {
    list.sort((a, b) => {
      const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      if (rank !== 0) return rank;
      return orderTime(b).localeCompare(orderTime(a));
    });
    const chosen = list[0];
    const pendingCancellation = isPendingCancellation(chosen);
    const excluded = excludePendingCancellation() && pendingCancellation;
    members.push({
      memberId,
      name: namesById.get(memberId) || "Member",
      status: pendingCancellation ? "Active, cancels next payment" : statusLabel(chosen.status),
      active: chosen.status === "ACTIVE" && !excluded,
      pendingCancellation,
      startDate: chosen.startDate || null,
      endDate: endDateFor(chosen),
    });
  }

  members.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name, "en");
  });
  return members;
}

export function activeEntrants(members) {
  const seen = new Set();
  const entrants = [];
  for (const member of members) {
    if (!member.active || seen.has(member.memberId)) continue;
    seen.add(member.memberId);
    entrants.push(member);
  }
  return entrants;
}
