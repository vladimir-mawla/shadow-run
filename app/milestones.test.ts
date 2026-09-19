import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MILESTONES } from "./milestones";

/**
 * Keeps the deployed page from claiming progress the project has not made.
 *
 * Copied as a mechanism from decision-engine's own app/milestones.test.ts:
 * this guard exists because of a specific, observed failure on that
 * project's own history — the landing page announced "Milestone M2 of 9"
 * for the whole of M3 and M4, on a public URL, because the number lived in
 * prose. That was fixed by deriving it from a module, which is what
 * app/milestones.ts is here.
 *
 * But deriving it from a module only moves the problem: milestones.ts and
 * .genesis/DONE.html can still disagree, and nothing would notice. So this
 * asserts the one property that matters publicly: **the set of milestones
 * claimed complete must be identical in both places.** This test is itself
 * part of M2 (not a later milestone) precisely so the mechanism exists
 * before this project has any live page for it to protect.
 *
 * It deliberately does NOT compare the not-done states. DONE.html tracks
 * build/verification state while the module describes what a stranger
 * should be told; those granularities differ on purpose (see
 * milestones.ts's own comment on why M1 is "in-progress" there while
 * pending L4 verification), and forcing them to match would make this test
 * fight legitimate edits rather than catch false claims.
 */
const DONE_HTML = new URL("../.genesis/DONE.html", import.meta.url);

/** Every (milestone id, pill state) pair in DONE.html's status table. */
function pillsInDoneHtml(): { id: string; state: string }[] {
  const html = readFileSync(DONE_HTML, "utf8");
  const rows = html.matchAll(
    /<tr><td>(M\d+)<\/td>(?:(?!<\/tr>)[\s\S])*?<span class="pill[^"]*">([a-z]+)<\/span>/g,
  );
  return [...rows].map((r) => ({ id: r[1]!, state: r[2]! }));
}

/** DONE.html ids are "M1"-style; the module's are numeric. Normalise here so
 *  neither source has to change shape to satisfy a test. */
const completedInDoneHtml = (): number[] =>
  pillsInDoneHtml()
    .filter((p) => p.state === "done")
    .map((p) => Number(p.id.slice(1)));

describe("app/milestones.ts agrees with .genesis/DONE.html", () => {
  it("finds the milestone rows at all", () => {
    // A silently-empty parse would make every assertion below vacuously true,
    // so fail loudly if the markup is ever reshaped.
    const ids = pillsInDoneHtml().map((p) => Number(p.id.slice(1)));
    expect(ids.length).toBe(MILESTONES.length);
    expect(ids).toEqual(MILESTONES.map((m) => m.id));
  });

  it("claims exactly the same milestones complete in both places", () => {
    const fromModule = MILESTONES.filter((m) => m.status === "done").map((m) => m.id);
    expect(fromModule).toEqual(completedInDoneHtml());
  });
});
