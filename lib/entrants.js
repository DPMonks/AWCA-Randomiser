const STATUS_LABEL = {
  ACTIVE: "Active",
  CANCELED: "Cancelled",
  ENDED: "Ended",
  PAUSED: "Paused",
  PENDING: "Pending",
  DRAFT: "Draft",
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

function orderIdentity(order) {
  return String(order?.id || order?._id || order?.orderId || "").trim();
}

function createdStamp(order) {
  return String(order?.createdDate || order?._createdDate || "").trim();
}

function missingLast(value) {
  const text = String(value || "").trim();
  return text || "\uffff";
}

// One Wix plan order is one row. Active orders on the same member account are
// numbered by start date, then created date, then order id. Entry 1 has no
// suffix. Entry 2 is "(2)". Cancelled and ended orders are not numbered, so
// one remaining active order goes back to a single entry.
export function buildMembers(orders, namesById = new Map()) {
  const rows = [];
  const seenOrderIds = new Set();
  for (const order of orders || []) {
    const memberId = String(order?.buyer?.memberId || "").trim();
    if (!memberId) continue;
    const orderId = orderIdentity(order);
    if (orderId) {
      if (seenOrderIds.has(orderId)) continue;
      seenOrderIds.add(orderId);
    }
    const pendingCancellation = isPendingCancellation(order);
    const excluded = excludePendingCancellation() && pendingCancellation;
    rows.push({
      memberId,
      orderId,
      name: namesById.get(memberId) || "Member",
      status: pendingCancellation ? "Active, cancels next payment" : statusLabel(order.status),
      active: order.status === "ACTIVE" && !excluded,
      pendingCancellation,
      startDate: order.startDate || null,
      endDate: endDateFor(order),
      createdDate: createdStamp(order),
      entryNumber: 1,
    });
  }

  const activeByMember = new Map();
  for (const row of rows) {
    if (!row.active) continue;
    const list = activeByMember.get(row.memberId) || [];
    list.push(row);
    activeByMember.set(row.memberId, list);
  }
  for (const list of activeByMember.values()) {
    list.sort((a, b) => {
      const start = missingLast(a.startDate).localeCompare(missingLast(b.startDate));
      if (start !== 0) return start;
      const created = missingLast(a.createdDate).localeCompare(missingLast(b.createdDate));
      if (created !== 0) return created;
      return String(a.orderId || "").localeCompare(String(b.orderId || ""));
    });
    list.forEach((row, index) => {
      row.entryNumber = index + 1;
    });
  }

  rows.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const name = a.name.localeCompare(b.name, "en");
    if (name !== 0) return name;
    const number = a.entryNumber - b.entryNumber;
    if (number !== 0) return number;
    const start = String(a.startDate || "").localeCompare(String(b.startDate || ""));
    if (start !== 0) return start;
    return String(a.orderId || "").localeCompare(String(b.orderId || ""));
  });
  return rows.map(({ createdDate, ...row }) => row);
}

export function activeEntrants(members) {
  return (members || [])
    .filter((member) => member?.active && member.memberId)
    .sort((a, b) => {
      const name = String(a.name || "").localeCompare(String(b.name || ""), "en");
      if (name !== 0) return name;
      const number = (Number(a.entryNumber) || 1) - (Number(b.entryNumber) || 1);
      if (number !== 0) return number;
      return String(a.memberId).localeCompare(String(b.memberId))
        || String(a.orderId || "").localeCompare(String(b.orderId || ""));
    });
}
