import { BUSINESS_CACHE_CONTROL } from "./business-supporters.js";
import { getBusinessSupporters } from "../lib/business.js";
import { listOrdersForPlan, listPlans } from "../lib/wix.js";
import {
  isSlug,
  readSlug,
  renderBusinessPage,
  renderDirectoryPage,
  renderStatusPage,
  sendBody,
} from "../lib/business-pages.js";

const HTML = "text/html; charset=utf-8";

function sendHtml(res, status, html, { cacheControl, robots }) {
  sendBody(res, status, html, { contentType: HTML, cacheControl, robots });
}

export function createHandler(deps = { listPlans, listOrdersForPlan }) {
  return async function handler(req, res) {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendHtml(res, 405, renderStatusPage({
          title: "Method not allowed | Alconbury Weald",
          heading: "Method not allowed",
          message: "This page only accepts GET.",
        }), { cacheControl: "no-store", robots: "noindex, follow" });
        return;
      }
      const slug = readSlug(req);
      let data;
      try {
        data = await getBusinessSupporters(deps);
      } catch (error) {
        console.error("AWCA business directory unavailable:", error?.message || error);
        sendHtml(res, 503, renderStatusPage({
          title: "Business supporters unavailable | Alconbury Weald",
          heading: "Business supporters are unavailable",
          message: "Please check back soon.",
        }), { cacheControl: "no-store", robots: "noindex, follow" });
        return;
      }
      const supporters = data.supporters || [];
      if (!slug) {
        sendHtml(res, 200, renderDirectoryPage(supporters), {
          cacheControl: BUSINESS_CACHE_CONTROL,
          robots: "index, follow",
        });
        return;
      }
      const match = isSlug(slug) ? supporters.find((item) => item.slug === slug) : null;
      if (!match) {
        sendHtml(res, 404, renderStatusPage({
          title: "Business not found | Alconbury Weald",
          heading: "Business not found",
          message: "That business page does not exist. The business may no longer be an active supporter.",
        }), { cacheControl: "no-store", robots: "noindex, follow" });
        return;
      }
      sendHtml(res, 200, renderBusinessPage(match), {
        cacheControl: BUSINESS_CACHE_CONTROL,
        robots: "index, follow",
      });
    } catch (error) {
      console.error(error);
      sendHtml(res, 500, renderStatusPage({
        title: "Something went wrong | Alconbury Weald",
        heading: "Something went wrong",
        message: "Please check back soon.",
      }), { cacheControl: "no-store", robots: "noindex, follow" });
    }
  };
}

export default createHandler();
