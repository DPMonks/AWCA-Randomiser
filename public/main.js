const HISTORY_UNAVAILABLE_MESSAGE = "Draw history is unavailable right now.";

const notice = document.getElementById("notice");
const adminForm = document.getElementById("admin-form");
const adminTools = document.getElementById("admin-tools");
const adminMessage = document.getElementById("admin-message");
const drawButton = document.getElementById("draw-button");
const drawResult = document.getElementById("draw-result");
let historyBlocked = false;
let latestRefs = [];
let queuedDraw = null;
let latestState = null;
let pollTimer = null;
let countdownTimer = null;
const demoParams = new URLSearchParams(location.search);
const demoMode = demoParams.get("demo") === "1";
let onDrumReady = null;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function londonMonth(date = new Date()) {
  const bag = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return `${bag.year}-${bag.month}`;
}

function monthTitle(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month || "");
  if (!match) return "Past draw";
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

function pastWinnerText(draw) {
  return `${monthTitle(draw.month)}: ${draw.label}. ${draw.entryCount} entries, pot ${draw.potLabel}.`;
}

function pastWinnerDetail(draw) {
  if (!draw) return "";
  const parts = [pastWinnerText(draw)];
  if (draw.drawnAtLabel) parts.push(`Drawn ${draw.drawnAtLabel}.`);
  if (draw.fingerprint) parts.push(`Fairness check: ${draw.fingerprint}.`);
  if (draw.entrantsHash) parts.push(`Entrants check: ${draw.entrantsHash}.`);
  return parts.join(" ");
}

function seenKey(draw) {
  return `awca-seen:${draw.month || ""}:${draw.entryRef || ""}:${draw.drawnAt || ""}`;
}

function syncDrum(refs) {
  latestRefs = Array.isArray(refs) ? refs : [];
  if (window.AwcaDrum) window.AwcaDrum.setEntries(latestRefs);
}

function playWinner(draw) {
  if (!draw) return;
  const run = () => window.AwcaDrum && window.AwcaDrum.playDraw({
    entryRef: draw.entryRef,
    label: draw.label,
  });
  if (window.AwcaDrum) run();
  else queuedDraw = run;
}

function autoplayDraw(draw) {
  if (!draw) return;
  const key = seenKey(draw);
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch (error) {
    console.error(error);
  }
  playWinner(draw);
}

function currentMonthDraw(history) {
  const month = londonMonth();
  return (history || []).find((draw) => draw.month === month && draw.label) || null;
}

function showWinnerCard(label) {
  const card = document.getElementById("winner-card");
  const text = document.getElementById("winner-card-label");
  if (!card || !text) return;
  text.textContent = label || "";
  card.hidden = false;
  card.classList.remove("is-on");
  window.requestAnimationFrame(() => card.classList.add("is-on"));
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) launchConfetti();
}

function hideWinnerCard() {
  const card = document.getElementById("winner-card");
  if (!card) return;
  card.classList.remove("is-on");
  card.hidden = true;
}

function launchConfetti() {
  const box = document.getElementById("confetti");
  if (!box) return;
  box.replaceChildren();
  const colors = ["#f2c14e", "#2b6c3f", "#ffffff", "#7eb6ff", "#e36b6b"];
  for (let i = 0; i < 36; i += 1) {
    const piece = document.createElement("i");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.25}s`;
    box.append(piece);
  }
  window.setTimeout(() => box.replaceChildren(), 2200);
}

function demoRef(index) {
  let n = Math.imul(index + 1, 0x9e3779b1) >>> 0;
  n ^= n >>> 16;
  return (n & 0xffffff).toString(16).toUpperCase().padStart(6, "0");
}

function historyMessage(data) {
  return data?.historyMessage || HISTORY_UNAVAILABLE_MESSAGE;
}

function applyHistoryAvailability(data) {
  historyBlocked = data?.historyAvailable === false;
  drawButton.disabled = historyBlocked;
  if (!historyBlocked) return "";
  const message = historyMessage(data);
  if (!adminTools.hidden) {
    setAdminMessage(message);
    drawResult.textContent = message;
  }
  return message;
}

const TOO_MANY_ATTEMPTS = "Too many attempts. Please try again in 15 minutes.";

function setAdminMessage(text, tone) {
  adminMessage.hidden = !text;
  adminMessage.textContent = text || "";
  adminMessage.classList.toggle("is-alert", Boolean(text) && tone === "alert");
}

function showExampleNotice(on) {
  const note = document.getElementById("example-notice");
  if (note) note.hidden = !on;
}

function showNotice(kind, text) {
  if (!text) {
    notice.hidden = true;
    notice.textContent = "";
    notice.className = "awca-banner";
    return;
  }
  notice.hidden = false;
  notice.className = `awca-banner ${kind}`;
  notice.textContent = text;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return { error: "The server sent a response that could not be read." };
  }
}

function renderPastWinners(history, unavailableMessage) {
  const select = document.getElementById("past-winners");
  const detail = document.getElementById("past-winner-detail");
  if (!select || !detail) return;
  select.replaceChildren();
  if (unavailableMessage) {
    select.disabled = true;
    select.add(new Option(unavailableMessage, ""));
    detail.textContent = unavailableMessage;
    return;
  }
  if (!history || history.length === 0) {
    select.disabled = true;
    select.add(new Option("No draws yet.", ""));
    detail.textContent = "No draws yet.";
    return;
  }
  select.disabled = false;
  history.forEach((draw, index) => {
    select.add(new Option(pastWinnerText(draw), String(index)));
  });
  const show = () => {
    const draw = history[Number(select.value)];
    detail.textContent = draw ? pastWinnerDetail(draw) : "";
  };
  select.onchange = show;
  show();
}

function formatRemain(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  return days ? `${days}d ${clock}` : clock;
}

function waitingForResult(data) {
  if (demoMode || !data || data.historyAvailable === false) return false;
  if (currentMonthDraw(data.history)) return false;
  if (data.drawDue) return true;
  const target = Date.parse(data.nextDraw || "");
  return Number.isFinite(target) && Date.now() >= target;
}

function setDigit(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value).padStart(2, "0");
}

function paintDrumCountdown(remainMs, mode) {
  const root = document.getElementById("drum-countdown");
  const label = document.getElementById("drum-countdown-label");
  const digits = document.getElementById("drum-countdown-digits");
  const status = document.getElementById("drum-countdown-status");
  if (!root || !label || !digits || !status) return;
  if (mode === "progress") {
    label.hidden = true;
    digits.hidden = true;
    status.hidden = false;
    status.textContent = "Draw in progress";
    root.setAttribute("aria-label", "Draw in progress");
    return;
  }
  const total = Math.max(0, Math.floor(Number(remainMs) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  label.hidden = false;
  label.textContent = "Next draw in";
  digits.hidden = false;
  status.hidden = true;
  setDigit("cd-days", days);
  setDigit("cd-hours", hours);
  setDigit("cd-minutes", minutes);
  setDigit("cd-seconds", seconds);
  root.setAttribute(
    "aria-label",
    `Next draw in ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`
  );
}

function paintCountdown() {
  const el = document.getElementById("draw-countdown");
  if (demoMode || !latestState) return;
  const target = Date.parse(latestState.nextDraw || "");
  const historyOff = latestState.historyAvailable === false;
  const waiting = waitingForResult(latestState);
  if (el) {
    if (historyOff) el.textContent = "";
    else if (waiting) el.textContent = "Drawing now";
    else if (!Number.isFinite(target)) el.textContent = "";
    else {
      const remain = target - Date.now();
      el.textContent = remain <= 0 ? "Drawing now" : formatRemain(remain);
    }
  }
  if (!Number.isFinite(target)) return;
  const remain = target - Date.now();
  if (waiting || (!historyOff && remain <= 0)) paintDrumCountdown(0, "progress");
  else paintDrumCountdown(remain, "count");
}

function ensureCountdown() {
  paintCountdown();
  if (countdownTimer || demoMode) return;
  countdownTimer = window.setInterval(() => {
    paintCountdown();
    if (waitingForResult(latestState)) ensurePoll();
  }, 1000);
}

function ensurePoll() {
  if (demoMode || pollTimer || !waitingForResult(latestState)) return;
  pollTimer = window.setInterval(() => {
    loadState();
  }, 5000);
}

function stopPoll() {
  if (!pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

function renderState(data) {
  latestState = data;
  document.getElementById("total-entries").textContent = String(data.activeEntries ?? 0);
  document.getElementById("total-winnings").textContent = data.potLabel || "Unavailable";
  document.getElementById("next-draw").textContent = data.nextDrawLabel || "Unavailable";
  ensureCountdown();
  if (waitingForResult(data)) ensurePoll();
  else stopPoll();
  const unavailable = applyHistoryAvailability(data);
  if (unavailable) {
    document.getElementById("last-winner-name").textContent = "History unavailable";
    document.getElementById("last-winner-meta").textContent = unavailable;
  } else if (data.lastWinner) {
    document.getElementById("last-winner-name").textContent = data.lastWinner.label;
    document.getElementById("last-winner-meta").textContent = data.lastWinner.drawnAtLabel;
  } else {
    document.getElementById("last-winner-name").textContent = "No winner yet";
    document.getElementById("last-winner-meta").textContent = "The first official draw has not been saved.";
  }
  renderPastWinners(data.history, unavailable);
  if (!demoMode) {
    syncDrum(data.entryRefs || []);
    const nightly = currentMonthDraw(data.history);
    if (nightly) autoplayDraw(nightly);
  }
  showExampleNotice(demoMode || data.mock === true);
  if (data.mock) {
    showNotice("mock", "Sample data is on. These are not real members.");
  } else if (unavailable) {
    showNotice("error", unavailable);
  } else {
    showNotice("", "");
  }
}

async function loadState() {
  try {
    const response = await fetch("/api/state", { headers: { Accept: "application/json" } });
    const data = await readJson(response);
    if (!response.ok) {
      showNotice("error", data.error || "The lottery details could not be loaded.");
      document.getElementById("total-entries").textContent = "Unavailable";
      document.getElementById("total-winnings").textContent = "Unavailable";
      document.getElementById("next-draw").textContent = "Unavailable";
      document.getElementById("last-winner-name").textContent = "Unavailable";
      document.getElementById("last-winner-meta").textContent = "";
      return;
    }
    renderState(data);
  } catch (error) {
    console.error(error);
    showNotice("error", "The lottery details could not be loaded.");
  }
}

function renderAdminHistory(draws, unavailableMessage) {
  const list = document.getElementById("admin-history");
  if (!list) return;
  list.replaceChildren();
  if (unavailableMessage) {
    const item = document.createElement("li");
    item.textContent = unavailableMessage;
    list.append(item);
    return;
  }
  if (!draws || draws.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No draws yet.";
    list.append(item);
    return;
  }
  for (const draw of draws) {
    const item = document.createElement("li");
    const who = draw.fullName ? `${draw.fullName}${draw.email ? `, ${draw.email}` : ""}, ${draw.label}` : draw.label;
    const check = draw.fingerprint ? ` Fairness check: ${draw.fingerprint}.` : "";
    item.textContent = `${who}, ${draw.drawnAtLabel}.${check}`;
    list.append(item);
  }
}

async function loadAdminDraws() {
  const response = await fetch("/api/draws", { headers: { Accept: "application/json" } });
  const data = await readJson(response);
  if (!response.ok) {
    setAdminMessage(data.error || "The draw record could not be loaded.");
    return;
  }
  const unavailable = applyHistoryAvailability(data);
  renderAdminHistory(data.draws, unavailable);
}

let communityMembers = [];
let communityNotice = "";

function communityPlansText(member) {
  if (member.plansLabel) return member.plansLabel;
  if (member.plans && member.plans.length) return member.plans.join(", ");
  return "none";
}

function filteredCommunity(query) {
  const needle = String(query || "").trim().toLocaleLowerCase("en-GB");
  if (!needle) return communityMembers;
  return communityMembers.filter((member) => {
    const haystack = [member.name, member.email, communityPlansText(member)].join(" ").toLocaleLowerCase("en-GB");
    return haystack.includes(needle);
  });
}

function renderCommunity(data, options = {}) {
  const message = document.getElementById("community-message");
  const count = document.getElementById("community-count");
  const body = document.getElementById("community-rows");
  if (!message || !count || !body) return;
  if (!options.keepMessage) {
    communityNotice = [data?.message, data?.emailMessage, data?.plansMessage].filter(Boolean).join(" ");
    message.hidden = communityNotice.length === 0;
    message.textContent = communityNotice;
  }
  const query = document.getElementById("community-search")?.value || "";
  const shown = filteredCommunity(query);
  const total = communityMembers.length;
  count.textContent = query.trim() ? `${shown.length} of ${total} members` : `${total} members`;
  body.replaceChildren();
  if (data?.available === false) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "Community members could not be loaded.";
    row.append(cell);
    body.append(row);
    return;
  }
  if (shown.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = total === 0 ? "No site members were found." : "No members match that search.";
    row.append(cell);
    body.append(row);
    return;
  }
  for (const member of shown) {
    const row = document.createElement("tr");
    for (const value of [member.name, member.email, communityPlansText(member)]) {
      const cell = document.createElement("td");
      cell.textContent = value || "None";
      row.append(cell);
    }
    body.append(row);
  }
}

function clearCommunity() {
  communityMembers = [];
  communityNotice = "";
  const search = document.getElementById("community-search");
  if (search) search.value = "";
  renderCommunity({ available: true, members: [] });
}

async function loadCommunity() {
  const response = await fetch("/api/community-members", { headers: { Accept: "application/json" } });
  const data = await readJson(response);
  if (response.status === 401 || response.status === 503) return;
  if (!response.ok) {
    communityMembers = [];
    renderCommunity({ available: false, message: data.error || "Community members could not be loaded.", members: [] });
    return;
  }
  communityMembers = Array.isArray(data.members) ? data.members : [];
  renderCommunity(data);
}

function communityCsv(rows) {
  const lines = ["Name,Email,Plans"];
  for (const member of rows) {
    const cells = [member.name, member.email, communityPlansText(member)].map((value) => {
      const text = String(value ?? "");
      if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
      return text;
    });
    lines.push(cells.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function renderMembers(members) {
  const body = document.getElementById("member-rows");
  body.replaceChildren();
  if (!members || members.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No lottery plan members were found.";
    row.append(cell);
    body.append(row);
    return;
  }
  for (const member of members) {
    const row = document.createElement("tr");
    for (const value of [member.name, member.email, member.entryRef, member.status, member.startLabel, member.endLabel]) {
      const cell = document.createElement("td");
      cell.textContent = value || "None";
      row.append(cell);
    }
    body.append(row);
  }
}

function sponsorTile(slot) {
  const link = document.createElement("a");
  link.className = "awca-sponsor-tile";
  link.target = "_blank";
  link.rel = "noopener";
  if (slot.kind === "business" && slot.slug) {
    link.href = `/businesses/${encodeURIComponent(slot.slug)}`;
    link.setAttribute("data-business-click", slot.slug);
    const logo = document.createElement("span");
    logo.className = "awca-sponsor-logo";
    if (slot.logoUrl) {
      const img = document.createElement("img");
      img.src = slot.logoUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      logo.append(img);
    } else {
      logo.textContent = (slot.name || "A").trim().charAt(0).toUpperCase();
    }
    const name = document.createElement("span");
    name.className = "awca-sponsor-name";
    name.textContent = slot.name;
    link.append(logo, name);
    return link;
  }
  link.classList.add("is-open");
  link.href = slot.href || "https://www.alconbury-weald.org/pricing-plans/plans-pricing";
  const name = document.createElement("span");
  name.className = "awca-sponsor-name";
  name.textContent = slot.label || "Your business here";
  link.append(name);
  return link;
}

async function loadDrawSupporters() {
  const section = document.getElementById("draw-supporters");
  const list = document.getElementById("draw-supporters-list");
  if (!section || !list) return;
  try {
    const response = await fetch("/api/business-spotlight", { headers: { Accept: "application/json" } });
    const data = await readJson(response);
    const slots = Array.isArray(data.slots) ? data.slots : [];
    if (!response.ok || slots.length === 0) {
      section.hidden = true;
      return;
    }
    list.replaceChildren();
    const slugs = [];
    for (const slot of slots) {
      const item = document.createElement("li");
      if (slot.kind === "business" && slot.slug) {
        item.setAttribute("data-business-view", slot.slug);
        slugs.push(slot.slug);
      }
      item.append(sponsorTile(slot));
      list.append(item);
    }
    section.hidden = false;
    if (window.awcaRecordViews) window.awcaRecordViews(slugs);
  } catch (error) {
    console.error(error);
    section.hidden = true;
  }
}

function countCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value == null ? "Unavailable" : String(value);
  return cell;
}

function renderBusinessSubscriptions(data) {
  const body = document.getElementById("business-subscription-rows");
  const message = document.getElementById("business-subscription-message");
  if (!body) return;
  body.replaceChildren();
  if (message) {
    message.hidden = data?.available !== false && data?.statsAvailable !== false;
    if (data?.available === false) message.textContent = "Business subscriptions could not be loaded.";
    else if (data?.statsAvailable === false) message.textContent = "View and click counts are unavailable right now.";
    else message.textContent = "";
  }
  const rows = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "No business subscriptions were found.";
    row.append(cell);
    body.append(row);
    return;
  }
  for (const item of rows) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = item.name || "Name missing";
    const website = document.createElement("td");
    if (item.website) {
      const link = document.createElement("a");
      link.href = item.website;
      link.textContent = item.website;
      link.target = "_blank";
      link.rel = "noopener";
      website.append(link);
    } else {
      website.textContent = "None";
    }
    for (const value of [item.status, item.startLabel, item.endLabel, item.displayed ? "Yes" : "No"]) {
      const cell = document.createElement("td");
      cell.textContent = value || "None";
      row.append(cell);
    }
    row.prepend(website);
    row.prepend(name);
    row.append(countCell(item.views), countCell(item.clicks));
    body.append(row);
  }
}

async function loadBusinessSubscriptions() {
  const body = document.getElementById("business-subscription-rows");
  if (!body) return;
  const response = await fetch("/api/business-subscriptions", { headers: { Accept: "application/json" } });
  const data = await readJson(response);
  if (!response.ok) {
    renderBusinessSubscriptions({ available: false, subscriptions: [] });
    return;
  }
  renderBusinessSubscriptions(data);
}

async function loadMembers() {
  const response = await fetch("/api/members", { headers: { Accept: "application/json" } });
  const data = await readJson(response);
  if (response.status === 401) {
    adminForm.hidden = false;
    adminTools.hidden = true;
    return;
  }
  if (response.status === 429) {
    adminForm.hidden = false;
    adminTools.hidden = true;
    setAdminMessage(data.error || TOO_MANY_ATTEMPTS, "alert");
    return;
  }
  if (response.status === 503) {
    adminForm.hidden = false;
    adminTools.hidden = true;
    setAdminMessage(data.error || "Admin access is not configured.");
    return;
  }
  if (!response.ok) {
    setAdminMessage(data.error || "Member status could not be loaded.");
    return;
  }
  setAdminMessage("");
  adminForm.hidden = true;
  adminTools.hidden = false;
  renderMembers(data.members);
  applyHistoryAvailability(data);
  await loadAdminDraws();
  await loadCommunity();
  await loadBusinessSubscriptions();
  if (data.mock) {
    showNotice("mock", "Sample data is on. These are not real members.");
  }
}

adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("admin-password").value;
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await readJson(response);
    if (response.status === 429) {
      setAdminMessage(data.error || TOO_MANY_ATTEMPTS, "alert");
      return;
    }
    if (!response.ok) {
      setAdminMessage(data.error || "Sign-in failed.");
      return;
    }
    adminMessage.hidden = true;
    document.getElementById("admin-password").value = "";
    await loadMembers();
  } catch (error) {
    console.error(error);
    showNotice("error", "Sign-in failed.");
  }
});

document.getElementById("lock-button").addEventListener("click", async () => {
  await fetch("/api/session", { method: "DELETE" });
  adminForm.hidden = false;
  adminTools.hidden = true;
  drawResult.textContent = "No draw yet this session.";
  clearCommunity();
  const businessRows = document.getElementById("business-subscription-rows");
  if (businessRows) businessRows.replaceChildren();
});

document.getElementById("community-search")?.addEventListener("input", () => {
  renderCommunity({ available: true }, { keepMessage: true });
});

document.getElementById("community-copy")?.addEventListener("click", async () => {
  const emails = filteredCommunity(document.getElementById("community-search")?.value || "")
    .map((member) => String(member.email || "").trim())
    .filter((email) => email.includes("@"));
  const message = document.getElementById("community-message");
  if (emails.length === 0) {
    if (message) {
      message.hidden = false;
      message.textContent = communityNotice ? `No email addresses to copy. ${communityNotice}` : "No email addresses to copy.";
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(emails.join("\n"));
    if (message) {
      const copied = emails.length === 1 ? "Copied 1 email." : `Copied ${emails.length} emails.`;
      message.hidden = false;
      message.textContent = communityNotice ? `${copied} ${communityNotice}` : copied;
    }
  } catch (error) {
    console.error(error);
    if (message) {
      message.hidden = false;
      message.textContent = "The email list could not be copied.";
    }
  }
});

document.getElementById("community-csv")?.addEventListener("click", () => {
  const rows = filteredCommunity(document.getElementById("community-search")?.value || "");
  const blob = new Blob([communityCsv(rows)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "community-members.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});

drawButton.addEventListener("click", async () => {
  drawButton.disabled = true;
  drawButton.textContent = "Drawing...";
  try {
    const response = await fetch("/api/draw", { method: "POST", headers: { Accept: "application/json" } });
    const data = await readJson(response);
    if (!response.ok) {
      showNotice("error", data.error || "The draw could not be completed.");
      drawResult.textContent = data.error || "The draw could not be completed.";
      return;
    }
    const name = data.winner.fullName || data.winner.label;
    const email = data.winner.email ? `, ${data.winner.email}` : "";
    const prefix = data.alreadyDrawn ? "This month already has a winner" : "Winner";
    drawResult.textContent = `${prefix}: ${name}${email}. Public result: ${data.winner.label}. Drawn ${data.winner.drawnAtLabel}.`;
    try {
      sessionStorage.setItem(seenKey(data.winner), "1");
    } catch (error) {
      console.error(error);
    }
    playWinner(data.winner);
    await loadState();
    await loadAdminDraws();
  } catch (error) {
    console.error(error);
    showNotice("error", "The draw could not be completed.");
  } finally {
    drawButton.disabled = historyBlocked;
    drawButton.textContent = "Draw Winner";
  }
});

function demoCountdownSeconds() {
  const raw = demoParams.get("countdown");
  if (raw == null || !/^\d+$/.test(raw)) return 0;
  const seconds = Number(raw);
  if (seconds < 1 || seconds > 120) return 0;
  return seconds;
}

function londonStamp(date) {
  const bag = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return `${Number(bag.day)} ${MONTHS[Number(bag.month) - 1]} ${bag.year}, ${bag.hour}:${bag.minute}:${bag.second} UK time`;
}

function demoNightRefs(count) {
  const refs = [];
  const seen = new Set();
  for (let index = 0; refs.length < count; index += 1) {
    const ref = demoRef(index);
    if (seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  if (!seen.has("840053")) refs[refs.length - 1] = "840053";
  return refs;
}

function startDemoNight(seconds) {
  document.body.classList.add("demo-night");
  showExampleNotice(true);
  const controls = document.getElementById("demo-controls");
  if (controls) controls.hidden = true;
  const refs = demoNightRefs(40);
  syncDrum(refs);
  document.getElementById("total-entries").textContent = String(refs.length);
  document.getElementById("total-winnings").textContent = `£${(refs.length * 1.25).toFixed(2)}`;
  document.getElementById("last-winner-name").textContent = "No winner yet";
  document.getElementById("last-winner-meta").textContent = "Example draw. Not a real result.";
  const countdown = document.getElementById("draw-countdown");
  countdown.textContent = formatRemain(seconds * 1000);
  const winner = {
    month: londonMonth(),
    entryRef: "840053",
    label: "A.B. - Entry 840053",
    drawnAt: new Date().toISOString(),
  };
  let target = 0;
  let drew = false;
  const tick = () => {
    if (!target) return;
    const remain = target - Date.now();
    if (remain > 0) {
      countdown.textContent = formatRemain(remain);
      paintDrumCountdown(remain, "count");
      return;
    }
    countdown.textContent = "Drawing now";
    paintDrumCountdown(0, "progress");
    if (drew) return;
    drew = true;
    window.setTimeout(() => {
      winner.drawnAt = new Date().toISOString();
      document.getElementById("last-winner-name").textContent = winner.label;
      document.getElementById("last-winner-meta").textContent = "Example draw. Not a real result.";
      playWinner(winner);
    }, 1200);
  };
  document.getElementById("next-draw").textContent = "Example draw, 20:00 UK time";
  onDrumReady = () => {
    target = Date.now() + seconds * 1000;
    document.getElementById("next-draw").textContent = londonStamp(new Date(target));
    tick();
    window.setInterval(tick, 250);
  };
  if (window.AwcaDrum) {
    const start = onDrumReady;
    onDrumReady = null;
    start();
  }
}

function startDemo() {
  const admin = document.querySelector(".awca-admin-wrap");
  if (admin) admin.hidden = true;
  showNotice("demo", "Demo - example data");
  showExampleNotice(true);
  const seconds = demoCountdownSeconds();
  if (seconds) {
    startDemoNight(seconds);
    return;
  }
  const controls = document.getElementById("demo-controls");
  if (controls) controls.hidden = false;
  document.getElementById("next-draw").textContent = "1 October 2026, 20:00 UK time";
  const countdown = document.getElementById("draw-countdown");
  if (countdown) countdown.textContent = "";
  const demoTarget = Date.parse("2026-10-01T19:00:00.000Z");
  const tickDemoClock = () => {
    const remain = demoTarget - Date.now();
    if (remain <= 0) paintDrumCountdown(0, "progress");
    else paintDrumCountdown(remain, "count");
  };
  tickDemoClock();
  window.setInterval(tickDemoClock, 1000);
  document.getElementById("last-winner-name").textContent = "No winner yet";
  document.getElementById("last-winner-meta").textContent = "Example draw. Not a real result.";
  renderPastWinners([
    {
      month: "2026-08",
      label: "S.S. - Entry 205179",
      entryCount: 42,
      potLabel: "£52.50",
    },
    {
      month: "2026-07",
      label: "A.B. - Entry 11AA09",
      entryCount: 38,
      potLabel: "£47.50",
    },
  ], "");
  const slider = document.getElementById("entry-count");
  const value = document.getElementById("entry-count-value");
  const applyCount = () => {
    const count = Number(slider.value);
    value.textContent = String(count);
    const refs = Array.from({ length: count }, (_, index) => demoRef(index));
    syncDrum(refs);
    document.getElementById("total-entries").textContent = String(count);
    document.getElementById("total-winnings").textContent = `£${(count * 1.25).toFixed(2)}`;
  };
  slider.addEventListener("input", applyCount);
  document.getElementById("play-draw").addEventListener("click", () => {
    const count = Math.min(Number(slider.value), 100);
    const ref = demoRef(Math.floor(Math.random() * Math.max(count, 1)));
    const draw = {
      month: londonMonth(),
      entryRef: ref,
      label: `A.B. - Entry ${ref}`,
      drawnAt: new Date().toISOString(),
    };
    document.getElementById("last-winner-name").textContent = draw.label;
    document.getElementById("last-winner-meta").textContent = "Example draw. Not a real result.";
    playWinner(draw);
  });
  applyCount();
}

window.addEventListener("awca-drum-ready", () => {
  if (latestRefs.length) syncDrum(latestRefs);
  if (window.AwcaDrum) window.AwcaDrum.resize();
  if (onDrumReady) {
    const start = onDrumReady;
    onDrumReady = null;
    start();
  }
  if (queuedDraw) {
    const run = queuedDraw;
    queuedDraw = null;
    run();
  }
});
window.addEventListener("awca-reveal", (event) => showWinnerCard(event.detail?.label));
window.addEventListener("awca-reveal-end", hideWinnerCard);

loadDrawSupporters();
if (demoMode) startDemo();
else {
  loadState();
  loadMembers();
}
