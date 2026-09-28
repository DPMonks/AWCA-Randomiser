import { businessStatusLabel, renewalSchedule } from "./business-access.js";
import { readBusinessStats } from "./biz-stats.js";
import {
  buildSupporterRecords,
  extractBusinessName,
  extractWebsite,
  selectBusinessPlan,
  slugifyBusinessName,
} from "./business.js";
import { formatUkDate, londonMonthKey } from "./format.js";

function endLabel(schedule) {
  if (!schedule.endDate) return "None";
  const when = formatUkDate(schedule.endDate);
  return schedule.endNote ? `${when} (${schedule.endNote})` : when;
}

// One row per business order. displayed is true only for the order that is
// actually on the public pages. views and clicks are this month's public counts.
export function buildSubscriptionRows(orders, options = {}, stats = {}) {
  const now = options.now ?? Date.now();
  const records = buildSupporterRecords(orders, { ...options, now });
  const slugByOrder = new Map(records.map((record) => [record.order, record.supporter.slug]));
  const available = options.statsAvailable !== false;
  const rows = [];
  for (const order of orders || []) {
    if (!order) continue;
    if (options.planId && order.planId && order.planId !== options.planId) continue;
    const data = order.formData?.submissionData || {};
    const extracted = extractBusinessName(data, options.nameField || "");
    const name = extracted || "Name missing";
    const website = extractWebsite(data, options.websiteField || "") || null;
    const schedule = renewalSchedule(order);
    const slug = slugByOrder.get(order) || (extracted ? slugifyBusinessName(extracted) : "");
    const counts = slug && stats[slug] ? stats[slug] : { views: 0, clicks: 0 };
    rows.push({
      name,
      website,
      status: businessStatusLabel(order, now),
      startDate: order.startDate || null,
      startLabel: formatUkDate(order.startDate),
      endDate: schedule.endDate,
      endNote: schedule.endNote,
      endLabel: endLabel(schedule),
      displayed: slugByOrder.has(order),
      views: available ? counts.views : null,
      clicks: available ? counts.clicks : null,
    });
  }
  rows.sort((a, b) => {
    if (a.displayed !== b.displayed) return a.displayed ? -1 : 1;
    return a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" });
  });
  return rows;
}

export async function getBusinessSubscriptions(deps, env = process.env, { now = new Date(), store = null } = {}) {
  const instant = now instanceof Date ? now : new Date(now);
  const plans = await deps.listPlans();
  const plan = selectBusinessPlan(plans, env.WIX_BUSINESS_PLAN_ID);
  const options = {
    planId: plan?.id || "",
    nameField: env.WIX_BUSINESS_NAME_FIELD,
    logoField: env.WIX_BUSINESS_LOGO_FIELD,
    websiteField: env.WIX_BUSINESS_WEBSITE_FIELD,
    now: instant.getTime(),
  };
  if (!plan) {
    return { available: true, month: londonMonthKey(instant), statsAvailable: true, subscriptions: [] };
  }
  const orders = await deps.listOrdersForPlan(plan.id);
  const records = buildSupporterRecords(orders, options);
  const slugs = new Set(records.map((record) => record.supporter.slug));
  for (const order of orders || []) {
    if (options.planId && order?.planId && order.planId !== options.planId) continue;
    const name = extractBusinessName(order?.formData?.submissionData || {}, options.nameField);
    if (name) slugs.add(slugifyBusinessName(name));
  }
  let stats = {};
  let statsAvailable = true;
  if (!store) {
    statsAvailable = false;
  } else {
    try {
      const read = await readBusinessStats(store, [...slugs], instant);
      stats = read.stats;
    } catch (error) {
      statsAvailable = false;
      console.error("AWCA business stats unavailable:", error?.message || error);
    }
  }
  return {
    available: true,
    month: londonMonthKey(instant),
    statsAvailable,
    subscriptions: buildSubscriptionRows(orders, { ...options, statsAvailable }, stats),
  };
}
