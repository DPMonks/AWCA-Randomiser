import { createHash } from "node:crypto";

export function sortedEntryRefs(entryRefs) {
  return [...(entryRefs || [])].map((ref) => String(ref || "").trim()).filter(Boolean).sort();
}

function sha256Lines(lines) {
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

// Hash of the sorted entry references, one reference per line.
export function hashEntrantRefs(entryRefs) {
  return sha256Lines(sortedEntryRefs(entryRefs));
}

// SHA-256 hex of month, drawnAt, winner index, then the sorted entry references.
// The winner index counts from 0 in that sorted list.
export function drawFingerprint({ month, drawnAt, entryRefs, winnerIndex } = {}) {
  const sorted = sortedEntryRefs(entryRefs);
  return sha256Lines([String(month || ""), String(drawnAt || ""), String(winnerIndex), ...sorted]);
}
