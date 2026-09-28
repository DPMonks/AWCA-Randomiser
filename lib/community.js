import { EMAIL_UNAVAILABLE, memberDisplayName } from "./entrants.js";
import { MOCK_COMMUNITY_MEMBERS, isMockMode } from "./mock.js";
import { listAllMembers, listAllOrders, listPlans, resolveMemberEmails } from "./wix.js";

export const MEMBERS_PERMISSION_MESSAGE =
  "Community members could not be loaded. Add Read Members (SCOPE.DC-MEMBERS.READ-MEMBERS) to the Wix API key.";

export const CONTACTS_PERMISSION_MESSAGE =
  "Some email addresses could not be read. Add Read Contacts (SCOPE.DC-CONTACTS.READ-CONTACTS) to the Wix API key. Login emails need Read Members (SCOPE.DC-MEMBERS.READ-MEMBERS).";

export const ORDERS_PERMISSION_MESSAGE =
  "Pricing plans could not be loaded. Add Read Orders (SCOPE.DC-PAIDPLANS.READ-ORDERS) to the Wix API key.";

export const PLANS_UNAVAILABLE = "Plans unavailable";

function memberIdOf(member) {
  return String(member?.id || member?._id || member?.memberId || "").trim();
}

function orderPlanLabel(order, plansById) {
  const direct = String(order?.planName || order?.plan?.name || order?.plan?.title || "").trim();
  if (direct) return direct;
  const id = String(order?.planId || order?.plan?.id || "").trim();
  return String(plansById.get(id)?.name || "").trim();
}

export function buildCommunityRows(rawMembers, orders, plans, emails, { plansUnavailable = false } = {}) {
  const plansById = new Map((plans || []).filter((plan) => plan?.id).map((plan) => [plan.id, plan]));
  const activeByMember = new Map();
  if (!plansUnavailable) {
    for (const order of orders || []) {
      if (order?.status !== "ACTIVE") continue;
      const memberId = String(order?.buyer?.memberId || "").trim();
      if (!memberId) continue;
      const label = orderPlanLabel(order, plansById);
      if (!label) continue;
      const names = activeByMember.get(memberId) || new Set();
      names.add(label);
      activeByMember.set(memberId, names);
    }
  }

  const rows = [];
  const seen = new Set();
  for (const member of rawMembers || []) {
    const id = memberIdOf(member);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const planNames = activeByMember.has(id)
      ? [...activeByMember.get(id)].sort((a, b) => a.localeCompare(b, "en"))
      : [];
    const email = emails?.get?.(id) || member.email || "";
    rows.push({
      name: member.name || memberDisplayName(member),
      email,
      plans: plansUnavailable ? [] : planNames,
      plansLabel: plansUnavailable ? PLANS_UNAVAILABLE : planNames.length ? planNames.join(", ") : "none",
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en") || a.email.localeCompare(b.email, "en"));
  return rows;
}

export function filterCommunityRows(rows, query) {
  const needle = String(query || "").trim().toLocaleLowerCase("en");
  if (!needle) return rows || [];
  return (rows || []).filter((row) => {
    const haystack = [row.name, row.email, row.plansLabel, ...(row.plans || [])].join(" ").toLocaleLowerCase("en");
    return haystack.includes(needle);
  });
}

export function communityEmailList(rows) {
  return (rows || [])
    .map((row) => String(row.email || "").trim())
    .filter((email) => email.includes("@") && email !== EMAIL_UNAVAILABLE);
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function communityCsv(rows) {
  const lines = ["Name,Email,Plans"];
  for (const row of rows || []) {
    lines.push([row.name, row.email, row.plansLabel || "none"].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function forbidden(error) {
  return error?.code === "WIX_FORBIDDEN";
}

export async function getCommunityMembers() {
  if (isMockMode()) {
    const orders = [];
    for (const member of MOCK_COMMUNITY_MEMBERS) {
      for (const planName of member.plans || []) {
        orders.push({ status: "ACTIVE", buyer: { memberId: member.id }, planName });
      }
    }
    return {
      available: true,
      mock: true,
      message: "",
      emailMessage: "",
      plansMessage: "",
      members: buildCommunityRows(MOCK_COMMUNITY_MEMBERS, orders, [], new Map()),
    };
  }

  let raw;
  try {
    raw = await listAllMembers();
  } catch (error) {
    if (!forbidden(error)) throw error;
    console.error(`AWCA community members unavailable: ${MEMBERS_PERMISSION_MESSAGE}`);
    return {
      available: false,
      mock: false,
      message: MEMBERS_PERMISSION_MESSAGE,
      emailMessage: "",
      plansMessage: "",
      members: [],
    };
  }

  const byId = new Map();
  for (const member of raw) {
    const id = memberIdOf(member);
    if (id && !byId.has(id)) byId.set(id, member);
  }
  const emails = await resolveMemberEmails(byId);
  const emailMessage = [...emails.values()].includes(EMAIL_UNAVAILABLE) ? CONTACTS_PERMISSION_MESSAGE : "";

  let orders = [];
  let plans = [];
  let plansMessage = "";
  try {
    orders = await listAllOrders();
  } catch (error) {
    if (!forbidden(error)) throw error;
    plansMessage = ORDERS_PERMISSION_MESSAGE;
    console.error(`AWCA community plans unavailable: ${plansMessage}`);
  }
  if (!plansMessage) {
    try {
      plans = await listPlans();
    } catch (error) {
      if (!forbidden(error)) throw error;
      console.error("AWCA plan names unavailable. Order plan names will be used where Wix sent them.");
    }
  }

  return {
    available: true,
    mock: false,
    message: "",
    emailMessage,
    plansMessage,
    members: buildCommunityRows([...byId.values()], orders, plans, emails, { plansUnavailable: Boolean(plansMessage) }),
  };
}
