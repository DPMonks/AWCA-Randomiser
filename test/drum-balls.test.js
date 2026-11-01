import assert from "node:assert/strict";
import test from "node:test";
import { ballEntries, MAX_BALLS } from "../public/ballList.js";

const PREVIEW_REFS = ["0D5F6A", "11CD1C", "5C8238", "B9488D", "C0601D", "CC93E0", "D62F01"];

test("seven entry codes become seven balls, not the two plan orders", () => {
  const plan = PREVIEW_REFS.slice(0, 2).map((ref) => ({ ref, initials: "A.B." }));
  const manual = PREVIEW_REFS.slice(2).map((ref, index) => ({ ref, initials: `M.${String.fromCharCode(65 + index)}.` }));
  const built = ballEntries([...plan, ...manual]);
  assert.equal(MAX_BALLS >= 7, true);
  assert.equal(built.hidden, 0);
  assert.equal(built.entries.length, 7);
  assert.deepEqual(built.entries.map((ball) => ball.ref), PREVIEW_REFS);
  for (const ball of built.entries) {
    assert.equal(ball.lines.at(-1) === ball.ref || ball.lines.includes(ball.ref.slice(0, 6)), true);
    assert.equal(ball.lines[0].includes("@"), false);
    assert.equal(ball.lines.join(" ").includes("email"), false);
    assert.match(ball.lines[0], /^[A-Z](?:\.[A-Z])*\.$/);
  }
});

test("ball labels keep initials and the code, and drop addresses", () => {
  const built = ballEntries([
    { ref: "aaaaaa", initials: "D.M." },
    { ref: "BBBBBB (2)", initials: "secret@example.com" },
    { ref: "CCCCCC", initials: "Not A Name" },
    "DDDDDD",
    { ref: "AAAAAA", initials: "Z.Z." },
  ]);
  assert.equal(built.entries.length, 4);
  assert.deepEqual(built.entries[0].lines, ["D.M.", "AAAAAA"]);
  assert.deepEqual(built.entries[1].lines, ["BBBBBB", "(2)"]);
  assert.deepEqual(built.entries[2].lines, ["CCCCCC"]);
  assert.deepEqual(built.entries[3].lines, ["DDDDDD"]);
  assert.equal(JSON.stringify(built).includes("@"), false);
  assert.equal(JSON.stringify(built).includes("secret"), false);
});
