import { API_BASE } from "./config.js";

const drawBtn = document.getElementById("drawBtn");
const resultDiv = document.getElementById("result");

drawBtn.addEventListener("click", async () => {
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
});
