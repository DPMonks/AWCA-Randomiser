import { randomInt } from "node:crypto";

export function pickWinner(entrants, randomIntFn = randomInt) {
  if (!entrants || entrants.length === 0) return null;
  const index = randomIntFn(0, entrants.length);
  return entrants[index];
}
