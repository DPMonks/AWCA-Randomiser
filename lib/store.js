import { readFile, writeFile } from "node:fs/promises";
import { LotteryError } from "./errors.js";
import { MOCK_SEED_DRAWS, isMockMode } from "./mock.js";
import { normalizeDraw } from "./privacy.js";
import { insertDrawIfAbsent, queryDraws } from "./wix.js";

export const HISTORY_UNAVAILABLE_MESSAGE =
  "Draw history is unavailable because Wix CMS is not added to the site yet. Add CMS in the Wix Editor and save to turn on draw history.";

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

function sortDraws(draws) {
  return draws.sort((a, b) => String(b.drawnAt).localeCompare(String(a.drawnAt)));
}

let mockQueue = Promise.resolve();

function enqueueMock(task) {
  const run = mockQueue.then(task, task);
  mockQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

function monthOf(draw) {
  return normalizeDraw(draw)?.month || "";
}

const mockDrawStore = {
  async list() {
    const extra = await readExtraDraws();
    return sortDraws([...extra, ...MOCK_SEED_DRAWS]);
  },
  async insertIfAbsent(draw) {
    return enqueueMock(async () => {
      const extra = await readExtraDraws();
      const existing = [...extra, ...MOCK_SEED_DRAWS].find((row) => monthOf(row) === draw.month);
      if (existing) return { record: normalizeDraw(existing), created: false };
      extra.unshift(draw);
      await writeFile(mockFile(), JSON.stringify({ extra }), "utf8");
      return { record: normalizeDraw(draw), created: true };
    });
  },
};

function wixDrawStore() {
  return {
    async list() {
      return queryDraws();
    },
    async insertIfAbsent(draw) {
      return insertDrawIfAbsent(draw);
    },
  };
}

// Swap this adapter to move draw history off Wix CMS. Contract:
// { list(): Promise<draw[]>, insertIfAbsent(draw): Promise<{ record, created }> }
export function drawStore() {
  return isMockMode() ? mockDrawStore : wixDrawStore();
}

export async function listDraws() {
  try {
    return { available: true, draws: await drawStore().list() };
  } catch (error) {
    if (isMockMode() || !isHistoryStoreError(error)) throw error;
    console.warn(`AWCA draw history unavailable: ${error.message}`);
    return { available: false, draws: [] };
  }
}

export async function insertIfAbsent(draw) {
  try {
    return await drawStore().insertIfAbsent(draw);
  } catch (error) {
    if (isMockMode() || !isHistoryStoreError(error)) throw error;
    console.error(`AWCA draw history unavailable: ${error.message}`);
    throw new LotteryError(HISTORY_UNAVAILABLE_MESSAGE, 503, "HISTORY_UNAVAILABLE");
  }
}

export async function saveDraw(draw) {
  const saved = await insertIfAbsent(draw);
  return saved.record;
}
