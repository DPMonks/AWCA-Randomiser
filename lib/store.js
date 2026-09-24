import { readFile, writeFile } from "node:fs/promises";
import { LotteryError } from "./errors.js";
import { MOCK_SEED_DRAWS, isMockMode } from "./mock.js";
import { insertDraw, queryDraws } from "./wix.js";

export const HISTORY_UNAVAILABLE_MESSAGE =
  "Draw history is unavailable: the Wix CMS is not enabled on the site. Enable CMS in the Wix dashboard to save draws.";

export function isHistoryStoreError(error) {
  const text = String(error?.message || "");
  if (/WDE0110|CMS app is not installed/i.test(text)) return true;
  if (error?.code === "WIX_ERROR" || error?.code === "WIX_FORBIDDEN") return true;
  if (error?.wixStatus) return true;
  return /does not exist|unknown collection|not found/i.test(text);
}

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

function mockDraws() {
  return readExtraDraws().then((extra) =>
    [...extra, ...MOCK_SEED_DRAWS].sort((a, b) => String(b.drawnAt).localeCompare(String(a.drawnAt)))
  );
}

export async function listDraws() {
  if (isMockMode()) {
    return { available: true, draws: await mockDraws() };
  }
  try {
    return { available: true, draws: await queryDraws() };
  } catch (error) {
    if (!isHistoryStoreError(error)) throw error;
    console.warn(`AWCA draw history unavailable: ${error.message}`);
    return { available: false, draws: [] };
  }
}

export async function saveDraw(draw) {
  if (isMockMode()) {
    const extra = await readExtraDraws();
    extra.unshift(draw);
    await writeFile(mockFile(), JSON.stringify({ extra }), "utf8");
    return;
  }
  try {
    await insertDraw(draw);
  } catch (error) {
    if (!isHistoryStoreError(error)) throw error;
    console.warn(`AWCA draw history unavailable: ${error.message}`);
    throw new LotteryError(HISTORY_UNAVAILABLE_MESSAGE, 503, "HISTORY_UNAVAILABLE");
  }
}
