import { readFile, writeFile } from "node:fs/promises";
import { LotteryError } from "./errors.js";
import { MOCK_SEED_DRAWS, isMockMode } from "./mock.js";
import { normalizeDraw } from "./privacy.js";
import {
  insertDrawIfAbsent,
  insertMailClaim as insertWixMailClaim,
  markMailClaim as markWixMailClaim,
  queryDraws,
  readMailClaim as readWixMailClaim,
  removeMailClaim as removeWixMailClaim,
} from "./wix.js";

export const CMS_NOT_INSTALLED_MESSAGE =
  "Draw history is unavailable because Wix CMS is not installed on the site.";

export const HISTORY_UNAVAILABLE_MESSAGE = "Draw history is unavailable right now.";

export function historyUnavailableMessage(error) {
  const text = String(error?.message || "");
  if (/WDE0110/i.test(text)) return CMS_NOT_INSTALLED_MESSAGE;
  return HISTORY_UNAVAILABLE_MESSAGE;
}

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

async function readMockState() {
  try {
    const raw = await readFile(mockFile(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      extra: Array.isArray(parsed.extra) ? parsed.extra : [],
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
    };
  } catch {
    return { extra: [], claims: [] };
  }
}

async function writeMockState(state) {
  await writeFile(mockFile(), JSON.stringify({ extra: state.extra, claims: state.claims }), "utf8");
}

async function readExtraDraws() {
  const state = await readMockState();
  return state.extra;
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
      const state = await readMockState();
      const existing = [...state.extra, ...MOCK_SEED_DRAWS].find((row) => monthOf(row) === draw.month);
      if (existing) return { record: normalizeDraw(existing), created: false };
      state.extra.unshift(draw);
      await writeMockState(state);
      return { record: normalizeDraw(draw), created: true };
    });
  },
  async insertMailClaim(claim) {
    return enqueueMock(async () => {
      const state = await readMockState();
      if (state.claims.some((row) => row.id === claim.id)) return { inserted: false, id: claim.id };
      state.claims.push({ ...claim, status: "claimed", detail: "" });
      await writeMockState(state);
      return { inserted: true, id: claim.id };
    });
  },
  async readMailClaim(id) {
    return enqueueMock(async () => {
      const state = await readMockState();
      return state.claims.find((row) => row.id === id) || null;
    });
  },
  async markMailClaim(id, patch) {
    return enqueueMock(async () => {
      const state = await readMockState();
      const row = state.claims.find((item) => item.id === id);
      if (!row) return false;
      Object.assign(row, patch);
      await writeMockState(state);
      return true;
    });
  },
  async removeMailClaim(id) {
    return enqueueMock(async () => {
      const state = await readMockState();
      const row = state.claims.find((item) => item.id === id);
      if (!row) return true;
      if (row.status === "sent") return false;
      state.claims = state.claims.filter((item) => item.id !== id);
      await writeMockState(state);
      return true;
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
    async insertMailClaim(claim) {
      return insertWixMailClaim(claim);
    },
    async readMailClaim(id) {
      return readWixMailClaim(id);
    },
    async markMailClaim(id, patch) {
      return markWixMailClaim(id, patch);
    },
    async removeMailClaim(id) {
      return removeWixMailClaim(id);
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
    const message = historyUnavailableMessage(error);
    console.warn(`AWCA draw history unavailable: ${error.message}`);
    return { available: false, draws: [], message };
  }
}

export async function insertIfAbsent(draw) {
  try {
    return await drawStore().insertIfAbsent(draw);
  } catch (error) {
    if (isMockMode() || !isHistoryStoreError(error)) throw error;
    const message = historyUnavailableMessage(error);
    console.error(`AWCA draw history unavailable: ${error.message}`);
    throw new LotteryError(message, 503, "HISTORY_UNAVAILABLE");
  }
}

export async function saveDraw(draw) {
  const saved = await insertIfAbsent(draw);
  return saved.record;
}

export async function insertMailClaim(claim) {
  return drawStore().insertMailClaim(claim);
}

export async function readMailClaim(id) {
  return drawStore().readMailClaim(id);
}

export async function markMailClaim(id, patch) {
  return drawStore().markMailClaim(id, patch);
}

export async function removeMailClaim(id) {
  return drawStore().removeMailClaim(id);
}
