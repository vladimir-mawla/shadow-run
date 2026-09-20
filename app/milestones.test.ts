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

/**
 * Every (milestone id, pill state) pair in a DONE.html-shaped status table.
 *
 * Takes the HTML as a parameter (rather than always reading the file) so a
 * decoy row can be fed through this exact code path in a test, not just
 * asserted about in prose.
 *
 * The original version of this parser matched
 * `<span class="pill[^"]*">` anywhere between a row's opening `<td>` and its
 * closing `</tr>`, non-greedily — i.e. "the first pill-ish span in the row."
 * That is wrong on two independent counts, either of which is enough to
 * misread a row:
 *   1. `pill[^"]*` matches by PREFIX, so a class like `pill-shaped-decoy`
 *      (which has nothing to do with the status column) satisfies it.
 *   2. Matching "anywhere in the row" means a decoy span earlier in a
 *      free-text title cell — e.g. M2's own row now has `<span
 *      class="note">` markup in its title — gets matched before the real
 *      status pill even though it isn't in the Status column at all.
 * The table's own header row (`#, Milestone, Phase, Demo command, Loops,
 * Status`) makes the fix obvious: the status pill is always the LAST `<td>`
 * in the row, structurally, regardless of what free-form markup earlier
 * cells contain. So this version (a) splits the row into its actual `<td>`
 * cells and only looks at the last one, and (b) matches the `pill` class as
 * an exact token (`pill` or `pill <status>`), not a prefix, as defense in
 * depth against a decoy class landing in that last cell too. A row whose
 * last cell has no pill at all throws instead of being silently dropped —
 * a guard that can fail open by shrinking its own result set is worse than
 * no guard.
 *
 * A first pass at this fix anchored to the last cell and matched the exact
 * class token, but still used `String.match()` *without* the `g` flag
 * inside that cell — which returns only the FIRST match. That still picks
 * a winner when the last cell contains more than one exact-token pill
 * span, e.g. `<span class="pill fake">wrongstate</span> <span
 * class="pill todo">todo</span>` reads "wrongstate". Not exploitable in
 * today's file (the Status column only ever holds one span) — but that is
 * exactly what was said about title cells before M2's row grew a
 * `<span class="note">`. So this version goes further: it requires the
 * last cell's ENTIRE trimmed content (nothing before or after, only
 * incidental whitespace stripped) to be exactly one pill span, anchored
 * with `^`/`$`. Two pills, a pill plus stray text, or an empty cell all
 * fail the full-string match and throw; only whitespace padding around a
 * single legitimate pill is tolerated.
 */
function pillsInHtml(html: string): { id: string; state: string }[] {
  // Only rows whose FIRST cell is a milestone id are data rows — this is
  // what lets the header row (`<tr><th>#</th>...`) be skipped on purpose,
  // rather than by accident. Any row that passes this gate is a milestone
  // row that must have a real status pill, so nothing past this point is
  // allowed to fail silently.
  const rows = [...html.matchAll(/<tr><td>M\d+<\/td>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  return rows.map((row) => {
    const idMatch = row.match(/<td>(M\d+)<\/td>/);
    if (!idMatch) {
      throw new Error(`DONE.html row has no milestone id in its first cell: ${row}`);
    }
    const id = idMatch[1]!;
    const cells = [...row.matchAll(/<td>[\s\S]*?<\/td>/g)].map((m) => m[0]);
    const lastCell = cells[cells.length - 1];
    if (lastCell === undefined) {
      throw new Error(`DONE.html row for ${id} has no <td> cells at all: ${row}`);
    }
    // The cell's inner content (between its own <td> and </td>), with only
    // incidental whitespace trimmed — everything else must be exactly one
    // pill span. This is what makes a second pill, or a pill plus stray
    // text, fail instead of `.match()` silently picking whichever comes
    // first in the string.
    const inner = lastCell.replace(/^<td>/, "").replace(/<\/td>$/, "").trim();
    // Exact class token match ("pill" or "pill <status>"), not a prefix —
    // see the function comment for why a prefix match is exploitable — and
    // anchored to the WHOLE trimmed cell (^...$), not searched for inside
    // it, so a second pill or trailing text can't hide next to a real one.
    const pillMatch = inner.match(/^<span class="pill(?: [a-z]+)?">([a-z]+)<\/span>$/);
    if (!pillMatch) {
      throw new Error(
        `DONE.html row for ${id} has a malformed status cell — expected exactly one status ` +
          `pill and nothing else, got: ${JSON.stringify(inner)}`,
      );
    }
    return { id, state: pillMatch[1]! };
  });
}

/** Every (milestone id, pill state) pair in DONE.html's status table. */
function pillsInDoneHtml(): { id: string; state: string }[] {
  return pillsInHtml(readFileSync(DONE_HTML, "utf8"));
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

describe("pillsInHtml (the drift guard's own parser)", () => {
  it("reads the row's real trailing status pill, not a decoy pill-ish span in the title cell", () => {
    // Verified reproduction of the bug: a decoy span earlier in the row's
    // free-text title cell (class starts with "pill" but isn't the status
    // pill) must not be what gets read. The rendered row's real status,
    // in its last cell, is "todo" — this must return "todo", not "done".
    const decoyRow =
      '<tr><td>M2</td><td>Deploy <span class="pill-shaped-decoy">done</span> a live skeleton ' +
      '<span class="note">note</span></td><td>DEPLOY</td><td><code>curl -sf ' +
      "$DEPLOY_URL/api/health</code></td><td>L1, L4</td><td>" +
      '<span class="pill todo">todo</span></td></tr>';

    expect(pillsInHtml(decoyRow)).toEqual([{ id: "M2", state: "todo" }]);
  });

  it("fails loudly, not silently, when a row's last cell has no status pill at all", () => {
    // A row that's missing its status pill entirely (malformed markup, a
    // half-finished edit, whatever) must be caught loudly. Silently
    // dropping it from the result set would make every drift assertion
    // pass vacuously for that milestone instead of failing where the real
    // problem is.
    const noPillRow =
      "<tr><td>M1</td><td>Contracts</td><td>BUILD</td>" +
      "<td><code>npm test -- contracts</code></td><td>L1, L4</td><td>oops, no pill here</td></tr>";

    expect(() => pillsInHtml(noPillRow)).toThrow(/malformed status cell/);
  });

  // Attacks run against the "anchor to the last cell" fix itself, after a
  // verifier found that fix still used a non-global, non-anchored
  // `.match()` inside the last cell — which returns only the FIRST match,
  // so a second exact-token pill span earlier in the cell than the real
  // one would still win. Each case below is a way a future edit could grow
  // a second thing into the Status cell without anyone intending a lie.
  const row = (lastCellInner: string) =>
    "<tr><td>M1</td><td>Contracts</td><td>BUILD</td>" +
    `<td><code>npm test -- contracts</code></td><td>L1, L4</td><td>${lastCellInner}</td></tr>`;

  it("attack: two pills in the last cell, decoy first — throws rather than picking the first", () => {
    const html = row('<span class="pill fake">wrongstate</span> <span class="pill todo">todo</span>');
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });

  it("attack: two pills in the last cell, real one first — throws rather than picking the first", () => {
    // Same bug, opposite order — proves the fix isn't "read the last match"
    // (which would just move the same failure mode instead of closing it).
    const html = row('<span class="pill todo">todo</span> <span class="pill fake">wrongstate</span>');
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });

  it("attack: a pill plus stray trailing text in the cell — throws", () => {
    const html = row('<span class="pill todo">todo</span> (pending review)');
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });

  it("attack: a pill plus stray leading text in the cell — throws", () => {
    const html = row('see note: <span class="pill todo">todo</span>');
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });

  it("a single pill padded with incidental leading/trailing whitespace still reads correctly", () => {
    // Whitespace from source formatting is not a decoy — only trimmed,
    // never allowed to hide a second element.
    const html = row('   <span class="pill todo">todo</span>   ');
    expect(pillsInHtml(html)).toEqual([{ id: "M1", state: "todo" }]);
  });

  it("attack: an empty status cell — throws rather than returning no state", () => {
    const html = row("");
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });

  it("attack: a status cell that is only whitespace — throws", () => {
    const html = row("   ");
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });
});

