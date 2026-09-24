const HISTORY_UNAVAILABLE_MESSAGE =
  "Draw history is unavailable because Wix CMS is not added to the site yet. Add CMS in the Wix Editor and save to turn on draw history.";

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

function armReplay(draw) {
  const button = document.getElementById("replay-draw");
  if (!button) return;
  if (!draw || !draw.label) {
    button.hidden = true;
    button.onclick = null;
    return;
  }
  button.hidden = false;
  button.onclick = () => playWinner(draw);
}

function autoplayDraw(draw) {
  armReplay(draw);
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

function setAdminMessage(text) {
  adminMessage.hidden = !text;
  adminMessage.textContent = text || "";
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
    detail.textContent = draw ? pastWinnerText(draw) : "";
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

function paintCountdown() {
  const el = document.getElementById("draw-countdown");
  if (!el || demoMode || !latestState) return;
  if (latestState.historyAvailable === false) {
    el.textContent = "";
    return;
  }
  if (waitingForResult(latestState)) {
    el.textContent = "Drawing now";
    return;
  }
  const target = Date.parse(latestState.nextDraw || "");
  if (!Number.isFinite(target)) {
    el.textContent = "";
    return;
  }
  const remain = target - Date.now();
  el.textContent = remain <= 0 ? "Drawing now" : formatRemain(remain);
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
    else armReplay(data.lastWinner);
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
    const who = draw.fullName ? `${draw.fullName}, ${draw.label}` : draw.label;
    item.textContent = `${who}, ${draw.drawnAtLabel}.`;
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

function renderMembers(members) {
  const body = document.getElementById("member-rows");
  body.replaceChildren();
  if (!members || members.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No lottery plan members were found.";
    row.append(cell);
    body.append(row);
    return;
  }
  for (const member of members) {
    const row = document.createElement("tr");
    for (const value of [member.name, member.entryRef, member.status, member.startLabel, member.endLabel]) {
      const cell = document.createElement("td");
      cell.textContent = value || "None";
      row.append(cell);
    }
    body.append(row);
  }
}

async function loadMembers() {
  const response = await fetch("/api/members", { headers: { Accept: "application/json" } });
  const data = await readJson(response);
  if (response.status === 401) {
    adminForm.hidden = false;
    adminTools.hidden = true;
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
    const prefix = data.alreadyDrawn ? "This month already has a winner" : "Winner";
    drawResult.textContent = `${prefix}: ${name}. Public result: ${data.winner.label}. Drawn ${data.winner.drawnAtLabel}.`;
    try {
      sessionStorage.setItem(seenKey(data.winner), "1");
    } catch (error) {
      console.error(error);
    }
    armReplay(data.winner);
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
      return;
    }
    countdown.textContent = "Drawing now";
    if (drew) return;
    drew = true;
    window.setTimeout(() => {
      winner.drawnAt = new Date().toISOString();
      document.getElementById("last-winner-name").textContent = winner.label;
      document.getElementById("last-winner-meta").textContent = "Example draw. Not a real result.";
      armReplay(winner);
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
    armReplay(draw);
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

if (demoMode) startDemo();
else {
  loadState();
  loadMembers();
}
