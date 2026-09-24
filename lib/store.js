import { readFile, writeFile } from "node:fs/promises";
import { MOCK_SEED_DRAWS, isMockMode } from "./mock.js";
import { insertDraw, queryDraws } from "./wix.js";

function mockFile() {
  return process.env.MOCK_DRAW_FILE || "/tmp/awca-lottery-draws.json";
}

async function readExtraDraws() {
  try {
    const raw = await readFile(mockFile(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.extra) ? parsed.extra : [];
  } catch {
    return [];
  }
}

export async function listDraws() {
  if (isMockMode()) {
    const extra = await readExtraDraws();
    return [...extra, ...MOCK_SEED_DRAWS].sort((a, b) => String(b.drawnAt).localeCompare(String(a.drawnAt)));
  }
  return queryDraws();
}

export async function saveDraw(draw) {
  if (isMockMode()) {
    const extra = await readExtraDraws();
    extra.unshift(draw);
    await writeFile(mockFile(), JSON.stringify({ extra }), "utf8");
    return;
  }
  await insertDraw(draw);
}
