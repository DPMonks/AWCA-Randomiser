const grid = document.getElementById("spotlight");
const statusEl = document.getElementById("status");

function tileLink(slot) {
  const link = document.createElement("a");
  link.className = "tile";
  link.target = "_blank";
  link.rel = "noopener";
  if (slot.kind === "business" && slot.slug) {
    link.href = "/businesses/" + encodeURIComponent(slot.slug);
    link.setAttribute("data-business-click", slot.slug);
    const logo = document.createElement("span");
    logo.className = "logo";
    if (slot.logoUrl) {
      const img = document.createElement("img");
      img.src = slot.logoUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      logo.append(img);
    } else {
      logo.classList.add("initial");
      logo.textContent = (slot.name || "A").trim().charAt(0).toUpperCase();
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = slot.name;
    link.append(logo, name);
    return link;
  }
  link.classList.add("open");
  link.href = slot.href || "https://www.alconbury-weald.org/pricing-plans/plans-pricing";
  const label = document.createElement("span");
  label.className = "name";
  label.textContent = slot.label || "Your business here";
  link.append(label);
  return link;
}

function render(slots) {
  grid.replaceChildren();
  const slugs = [];
  for (const slot of slots) {
    const item = document.createElement("li");
    if (slot.kind === "business" && slot.slug) {
      item.setAttribute("data-business-view", slot.slug);
      slugs.push(slot.slug);
    }
    item.append(tileLink(slot));
    grid.append(item);
  }
  statusEl.hidden = true;
  grid.hidden = false;
  if (window.awcaRecordViews) window.awcaRecordViews(slugs);
}

async function load() {
  try {
    const response = await fetch("/api/business-spotlight", { headers: { Accept: "application/json" } });
    const data = await response.json().catch(function () { return {}; });
    const slots = Array.isArray(data.slots) ? data.slots : [];
    if (!response.ok || slots.length === 0) {
      render([
        { kind: "placeholder" },
        { kind: "placeholder" },
        { kind: "placeholder" },
        { kind: "placeholder" },
      ]);
      return;
    }
    render(slots);
  } catch (error) {
    console.error(error);
    statusEl.textContent = "Business spotlight could not be loaded right now.";
  }
}

load();
