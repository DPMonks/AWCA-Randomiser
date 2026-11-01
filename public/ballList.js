export const BALL_REF = /^[0-9A-F]{6}(?: \((?:[2-9]|[1-9]\d+)\))?$/;
export const MAX_BALLS = 100;

function cleanInitials(value) {
  const text = String(value || "").trim();
  if (!text || text.includes("@") || /\s/.test(text)) return "";
  if (!/^[\p{L}.]+$/u.test(text) || !text.includes(".")) return "";
  return text;
}

function linesFor(ref, initials) {
  const match = /^([0-9A-F]{6}) \((\d+)\)$/.exec(ref);
  const code = match ? match[1] : ref;
  const lines = [];
  if (initials) lines.push(initials);
  lines.push(code);
  if (match) lines.push(`(${match[2]})`);
  return lines;
}

// One drum ball per entry code. There is no cap at the number of plan orders.
// Labels are initials and the entry code only. Anything with an address is dropped.
export function ballEntries(input) {
  const unique = [];
  const seen = new Set();
  for (const value of input || []) {
    const ref = String(value?.ref ?? value ?? "").trim().toUpperCase();
    if (!BALL_REF.test(ref) || seen.has(ref)) continue;
    seen.add(ref);
    const initials = value && typeof value === "object" ? cleanInitials(value.initials) : "";
    unique.push({ ref, lines: linesFor(ref, initials) });
  }
  return {
    entries: unique.slice(0, MAX_BALLS),
    hidden: Math.max(0, unique.length - MAX_BALLS),
  };
}
