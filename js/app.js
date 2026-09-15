import { API_BASE } from "./config.js";

const drawBtn = document.getElementById("drawBtn");
const resultDiv = document.getElementById("result");
const totalEntriesSpan = document.getElementById("totalEntries");
const estimatedAmountSpan = document.getElementById("estimatedAmount");
const ratePerSubscriberSpan = document.getElementById("ratePerSubscriber");

function updateStats(stats) {
  if (!stats) return;

  totalEntriesSpan.textContent = stats.totalEntries ?? 0;
  estimatedAmountSpan.textContent = (stats.estimatedAmount ?? 0).toFixed(2);
  ratePerSubscriberSpan.textContent = (stats.pricePerSubscriber ?? 1.25).toFixed(2);
}

async function fetchRandomiser() {
  resultDiv.textContent = "Drawing winner...";

  try {
    const res = await fetch(`${API_BASE}/randomiser`, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    updateStats(data.stats);

    if (!data || !data.winner) {
      resultDiv.textContent = "No winner returned from backend.";
      return;
    }

    const w = data.winner;
    resultDiv.textContent = `🎉 Winner: ${w.name} (${w.email})`;
  } catch (err) {
    console.error("Randomiser error:", err);
    resultDiv.textContent = "Error connecting to randomiser endpoint.";
  }
}

drawBtn.addEventListener("click", fetchRandomiser);
