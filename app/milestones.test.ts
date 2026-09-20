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
 * That let a decoy span earlier in a free-text title cell (e.g. M2's own
 * `<span class="note">` markup) win over the real status pill. Fixed by
 * anchoring to the row's LAST `<td>` (the table's own header names it
 * "Status") and requiring the whole trimmed cell to be exactly one pill
 * element — see `parsePillCellText` below for what's load-bearing in that
 * requirement versus what was calibration.
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
    // pill element. This is what makes a second pill, or a pill plus stray
    // text, fail instead of picking whichever comes first in the string.
    const inner = lastCell.replace(/^<td>/, "").replace(/<\/td>$/, "").trim();
    const state = parsePillCellText(inner, id);
    return { id, state };
  });
}

/**
 * Parses the trimmed inner content of a status cell — expected to be
 * EXACTLY ONE well-formed `<span class="pill ...">...</span>` element,
 * nothing before or after it — and returns its status text. Throws
 * otherwise.
 *
 * This function's restrictions fall into two categories, and mixing them
 * up is exactly how this guard got tightened past its own job across three
 * rounds of independent verification. The next person changing this
 * should know which bucket a given check is in before touching it.
 *
 * LOAD-BEARING — relaxing any of these reopens a real bypass:
 *   - Exactly ONE top-level element must span the WHOLE trimmed cell, with
 *     nothing else beside it. This is the fix that closed the original
 *     two-pill bypass (round 2): a naive "search for a pill in this cell"
 *     lets a second, decoy pill win by regex match order. Implemented
 *     below by walking `<span>`/`</span>` nesting depth from the outer
 *     tag, rather than a single greedy regex, specifically so two SIBLING
 *     spans (nesting depth returns to 0 before the string ends) are
 *     rejected even though a naive greedy `.*</span>$` would happily
 *     bridge them into one "match".
 *   - The class attribute must contain `pill` as an exact, word-bounded
 *     token, not a prefix — this is what rejects `pill-shaped-decoy`.
 *   - The extracted status text must be lowercase. This file's own
 *     convention is all-lowercase status words; a stray capital is a typo
 *     worth catching, not a shape this parser should shrug at.
 *   - Malformed markup — an unclosed `<span>`, a self-closing
 *     `<span class="pill todo" />` used AS the pill itself, sibling
 *     elements, a duplicated identical pill — all still throw. These are
 *     genuine breakage, not calibration targets.
 *
 * CALIBRATION — relaxed here (round 3) because they rejected ordinary
 * future edits with no bearing on drift-guard correctness, verified
 * against this exact file's own conventions:
 *   - Status text may contain digits and hyphens ("in-progress", "wip2"),
 *     not just plain letters — `app/milestones.ts` already uses
 *     "in-progress" as a real `Milestone["status"]` value.
 *   - The pill's class attribute may carry further tokens after `pill`
 *     ("pill ok extra") — a cosmetic CSS modifier has no semantic content.
 *   - The pill span may contain a nested, purely decorative element (e.g.
 *     an icon span) alongside its text. Handled by extracting the outer
 *     span's TEXT CONTENT (all nested tags stripped), not by requiring
 *     bare inner HTML with no children — while still requiring that
 *     nested markup to close entirely inside the one outer span.
 *
 * DELIBERATELY NOT relaxed, left for the next reader to decide: an HTML
 * comment inside the cell (before, after, or instead of the pill) also
 * throws here. Independent verification rated that mildly too strict but
 * low priority. There's no known legitimate reason for a comment in this
 * specific cell, so it's left strict rather than adding comment-stripping
 * logic for a case nobody has actually hit — but it would be a reasonable,
 * narrow follow-up if that ever changes.
 */
function parsePillCellText(cellInner: string, rowId: string): string {
  const fail = (reason: string): never => {
    throw new Error(
      `DONE.html row for ${rowId} has a malformed status cell — ${reason}: ${JSON.stringify(cellInner)}`,
    );
  };

  const openTagMatch = cellInner.match(/^<span class="pill(?:\s+[a-z0-9-]+)*">/);
  if (!openTagMatch) {
    return fail('does not open with a well-formed <span class="pill..."> element');
  }

  // Walk <span>/</span> nesting depth from just past the outer opening tag,
  // rather than one greedy regex, so a nested (decorative) span is
  // tolerated but the outer span's REAL close is found precisely — a
  // sibling pill after it must not be silently absorbed into the "match".
  let depth = 1;
  const tagPattern = /<\/?span\b[^>]*>/g;
  tagPattern.lastIndex = openTagMatch[0].length;
  let closeIndex = -1;
  let afterCloseIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(cellInner))) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth--;
      if (depth === 0) {
        closeIndex = match.index;
        afterCloseIndex = tagPattern.lastIndex;
        break;
      }
    } else if (tag.endsWith("/>")) {
      return fail("a self-closing <span/> is not well-formed markup here");
    } else {
      depth++;
    }
  }
  if (closeIndex === -1) {
    return fail("its <span> is never closed");
  }
  if (afterCloseIndex !== cellInner.length) {
    return fail("there is content beside the pill's closing </span> (a sibling element or stray text)");
  }

  const innerHtml = cellInner.slice(openTagMatch[0].length, closeIndex);
  const text = innerHtml.replace(/<[^>]*>/g, "").trim();
  if (!/^[a-z][a-z0-9-]*$/.test(text)) {
    return fail(`its pill text is not a plain lowercase status word (got ${JSON.stringify(text)})`);
  }
  return text;
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

  it("attack: an unclosed <span> — throws", () => {
    const html = row('<span class="pill todo">todo');
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });

  it("attack: a self-closing pill span — throws", () => {
    const html = row('<span class="pill todo" />');
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });

  it("attack: two duplicated, identical pills — throws (not silently deduplicated)", () => {
    const html = row('<span class="pill todo">todo</span><span class="pill todo">todo</span>');
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });

  it("attack: uppercase in the status text — throws (this file's own convention is all-lowercase)", () => {
    // Class token is valid lowercase ("todo") so this isolates the check to
    // the extracted TEXT specifically, not the class attribute shape.
    const html = row('<span class="pill todo">Todo</span>');
    expect(() => pillsInHtml(html)).toThrow(/malformed status cell/);
  });

  // Independent verification's round 3 found the round-2 fix had swung the
  // other way: it was now REJECTING ordinary, zero-risk future edits that
  // have no bearing on the guard's actual job. These cases must keep
  // working — a relaxation nobody pins in a regression test is a
  // relaxation the next round of "tighten this" will quietly undo.
  it("accepts a status word with a hyphen (\"in-progress\" is a real Milestone[\"status\"] value)", () => {
    const html = row('<span class="pill wip">in-progress</span>');
    expect(pillsInHtml(html)).toEqual([{ id: "M1", state: "in-progress" }]);
  });

  it("accepts a status word with a digit (\"wip2\")", () => {
    const html = row('<span class="pill wip">wip2</span>');
    expect(pillsInHtml(html)).toEqual([{ id: "M1", state: "wip2" }]);
  });

  it('accepts extra cosmetic class tokens after "pill" ("pill ok extra")', () => {
    const html = row('<span class="pill ok extra">done</span>');
    expect(pillsInHtml(html)).toEqual([{ id: "M1", state: "done" }]);
  });

  it("accepts a purely decorative nested element inside the pill (e.g. an icon span)", () => {
    // The nested span carries no text of its own (a real icon is normally
    // CSS/SVG-driven, not a text node) — the outer span's TEXT CONTENT is
    // still exactly "todo" once the nested tag is stripped.
    const html = row('<span class="pill todo"><span class="icon-dot" aria-hidden="true"></span> todo</span>');
    expect(pillsInHtml(html)).toEqual([{ id: "M1", state: "todo" }]);
  });
});

