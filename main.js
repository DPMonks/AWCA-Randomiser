const RANDOMISER_URL = "/api/randomiser";

async function loadStatsAndLastWinner() {
  try {
    const res = await fetch(RANDOMISER_URL);
    const data = await res.json();

    const stats = data.stats || {};
    const winner = data.winner || null;

    document.getElementById("total-entries").textContent =
      stats.totalEntries ?? "0";

    document.getElementById("total-winnings").textContent =
      stats.estimatedAmount != null ? `£${stats.estimatedAmount.toFixed(2)}` : "–";

    if (winner) {
      document.getElementById("last-winner-name").textContent = winner.name || "Winner";
      document.getElementById("last-winner-email").textContent = winner.email || "";
    }

    if (data.subscribers) {
      const list = document.getElementById("subscriber-list");
      list.innerHTML = "";
      data.subscribers.forEach(sub => {
        const li = document.createElement("li");
        li.textContent = `${sub.name} (${sub.email})`;
        list.appendChild(li);
      });
    }

    renderBalls(stats.totalEntries || 0);
  } catch (e) {
    console.error("Stats load failed:", e);
  }
}

function renderBalls(count) {
  const container = document.getElementById("balls-container");
  container.innerHTML = "";
  const maxBalls = Math.min(count, 20);

  for (let i = 0; i < maxBalls; i++) {
    const ball = document.createElement("div");
    ball.className = "awca-ball spin";
    ball.textContent = i + 1;

    const angle = (2 * Math.PI * i) / maxBalls;
    const radius = 70;
    const cx = 80 + radius * Math.cos(angle);
    const cy = 80 + radius * Math.sin(angle);

    ball.style.left = `${cx}px`;
    ball.style.top = `${cy}px`;

    container.appendChild(ball);

    setTimeout(() => ball.classList.remove("spin"), 1200);
  }
}

async function drawWinner() {
  const button = document.getElementById("draw-button");
  button.disabled = true;
  button.textContent = "Drawing…";

  try {
    const res = await fetch(RANDOMISER_URL, { method: "POST" });
    const data = await res.json();

    const winner = data.winner;
    const stats = data.stats || {};

    if (winner) {
      document.getElementById("winner-name").textContent = winner.name;
      document.getElementById("winner-email").textContent = winner.email;
      document.getElementById("winner-time").textContent = new Date().toLocaleString();

      document.getElementById("drawn-number").textContent =
        data.index != null ? data.index + 1 : "★";

      const chute = document.getElementById("machine-chute");
      chute.classList.add("active");
      setTimeout(() => chute.classList.remove("active"), 1500);
    }

    document.getElementById("total-entries").textContent =
      stats.totalEntries ?? "0";

    document.getElementById("total-winnings").textContent =
      stats.estimatedAmount != null ? `£${stats.estimatedAmount.toFixed(2)}` : "–";

    renderBalls(stats.totalEntries || 0);
  } catch (e) {
    console.error("Draw failed:", e);
  } finally {
    button.disabled = false;
    button.textContent = "Draw Winner";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadStatsAndLastWinner();
  setInterval(loadStatsAndLastWinner, 10000);
  document.getElementById("draw-button").addEventListener("click", drawWinner);
});
