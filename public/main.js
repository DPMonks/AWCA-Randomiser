const notice = document.getElementById("notice");
const adminForm = document.getElementById("admin-form");
const adminTools = document.getElementById("admin-tools");
const adminMessage = document.getElementById("admin-message");
const drawButton = document.getElementById("draw-button");
const drawResult = document.getElementById("draw-result");

function setAdminMessage(text) {
  adminMessage.hidden = !text;
  adminMessage.textContent = text || "";
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

function renderHistory(history) {
  const list = document.getElementById("history");
  list.replaceChildren();
  if (!history || history.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No draws yet.";
    list.append(item);
    return;
  }
  for (const draw of history) {
    const item = document.createElement("li");
    item.textContent = `${draw.label}, ${draw.drawnAtLabel}. ${draw.entryCount} entries, pot ${draw.potLabel}.`;
    list.append(item);
  }
}

function renderState(data) {
  document.getElementById("total-entries").textContent = String(data.activeEntries ?? 0);
  document.getElementById("total-winnings").textContent = data.potLabel || "Unavailable";
  document.getElementById("next-draw").textContent = data.nextDrawLabel || "Unavailable";
  if (data.lastWinner) {
    document.getElementById("last-winner-name").textContent = data.lastWinner.label;
    document.getElementById("last-winner-meta").textContent = data.lastWinner.drawnAtLabel;
  } else {
    document.getElementById("last-winner-name").textContent = "No winner yet";
    document.getElementById("last-winner-meta").textContent = "The first official draw has not been saved.";
  }
  renderHistory(data.history);
  if (data.mock) {
    showNotice("mock", "Sample data is on. These are not real members.");
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

function renderAdminHistory(draws) {
  const list = document.getElementById("admin-history");
  if (!list) return;
  list.replaceChildren();
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
  renderAdminHistory(data.draws);
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
    drawResult.textContent = `Winner: ${name}. Public result: ${data.winner.label}. Drawn ${data.winner.drawnAtLabel}.`;
    await loadState();
    await loadAdminDraws();
  } catch (error) {
    console.error(error);
    showNotice("error", "The draw could not be completed.");
  } finally {
    drawButton.disabled = false;
    drawButton.textContent = "Draw Winner";
  }
});

function startMachine() {
  const canvas = document.getElementById("lotteryCanvas");
  if (!canvas || !window.THREE) return;
  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    camera.position.z = 5;

    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const ball = new THREE.Mesh(geometry, material);
    scene.add(ball);

    const light = new THREE.PointLight(0xffffff, 1);
    light.position.set(5, 5, 5);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    function sizeCanvas() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function animate() {
      requestAnimationFrame(animate);
      ball.rotation.x += 0.01;
      ball.rotation.y += 0.01;
      renderer.render(scene, camera);
    }

    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
    animate();
  } catch (error) {
    console.error(error);
  }
}

loadState();
loadMembers();
startMachine();
