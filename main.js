// =====================
// 3D LOTTERY MACHINE
// =====================

const canvas = document.getElementById("lotteryCanvas");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

renderer.setSize(canvas.clientWidth, canvas.clientHeight);
camera.position.z = 5;

// Ball
const geometry = new THREE.SphereGeometry(1, 32, 32);
const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
const ball = new THREE.Mesh(geometry, material);
scene.add(ball);

// Lighting
const light = new THREE.PointLight(0xffffff, 1);
light.position.set(5, 5, 5);
scene.add(light);

function animate() {
  requestAnimationFrame(animate);
  ball.rotation.x += 0.01;
  ball.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();

// =====================
// LOTTERY BACKEND LOGIC
// =====================

const RANDOMISER_URL = "/api/randomiser";

async function loadStatsAndLastWinner() {
  try {
    const res = await fetch(RANDOMISER_URL);
    const data = await res.json();

    const stats = data.stats || {};
    const winner = data.winner || null;

    document.getElementById("total-entries").textContent = stats.totalEntries ?? "0";
    document.getElementById("total-winnings").textContent =
      stats.estimatedAmount != null ? `£${stats.estimatedAmount.toFixed(2)}` : "–";

    if (winner) {
      document.getElementById("last-winner-name").textContent = winner.name;
      document.getElementById("last-winner-email").textContent = winner.email;
    }
  } catch (e) {
    console.error("Stats load failed:", e);
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
    }

    document.getElementById("total-entries").textContent = stats.totalEntries ?? "0";
    document.getElementById("total-winnings").textContent =
      stats.estimatedAmount != null ? `£${stats.estimatedAmount.toFixed(2)}` : "–";
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
