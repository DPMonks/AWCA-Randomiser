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

function orderTime(order) {
  return String(order.updatedDate || order.createdDate || order.startDate || "");
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
    members.push({
      memberId,
      name: namesById.get(memberId) || "Member",
      status: statusLabel(chosen.status),
      active: chosen.status === "ACTIVE",
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
