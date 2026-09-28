// Cookie-free view and click counts. One view beacon per page load.
// Clicks use the real link, then a beacon. No identifiers are stored.
(function () {
  const sent = { view: false };

  function post(type, slugs) {
    const list = [];
    const seen = {};
    for (const slug of slugs) {
      const text = String(slug || "").trim();
      if (!text || seen[text]) continue;
      seen[text] = true;
      list.push(text);
    }
    if (!list.length) return;
    const body = JSON.stringify({ type: type, slugs: list });
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon("/api/business-stats", blob)) return;
      }
    } catch (error) {
      // Fall through to fetch.
    }
    fetch("/api/business-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true,
    }).catch(function () {});
  }

  function recordViews(slugs) {
    if (sent.view) return;
    const list = slugs && slugs.length ? slugs : viewsOnPage();
    if (!list.length) return;
    sent.view = true;
    post("view", list);
  }

  function viewsOnPage() {
    return Array.prototype.map.call(
      document.querySelectorAll("[data-business-view]"),
      function (node) { return node.getAttribute("data-business-view"); }
    );
  }

  window.awcaRecordViews = recordViews;

  document.addEventListener("click", function (event) {
    const link = event.target && event.target.closest ? event.target.closest("[data-business-click]") : null;
    if (!link) return;
    post("click", [link.getAttribute("data-business-click")]);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { recordViews(); });
  } else {
    recordViews();
  }
})();
