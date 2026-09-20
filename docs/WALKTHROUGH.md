# ~100-second walkthrough script

Built around the live demo on `/` (`components/InventoryDemo.tsx`, driven with `npm run dev`). No deployed
URL exists on this branch yet — the same script will work identically once one does, for the reason
`app/page.tsx`'s own on-screen copy states and this project's `node:`-free production files confirm directly:
the whole pipeline (`simulate()`, `reconcile()`, `runRollback()`, `inventoryDomain.applyReal()`) runs
client-side, reads no network state, and is verified here against this branch's own real output, not copied
from the sibling project's script by analogy. One continuous take. Every number and every line of copy below
was read off an actual run of this exact branch (see the reports this doc's own PR quotes) — nothing here is
the design doc's aspirational phrasing re-typed without checking it against a real run.

**A real finding this script had to account for, not paper over:** `sim-plan.md` §B's own headline sentence —
"stock.reserved: predicted 42, observed 45" — is NOT what the whole-pipeline `reconcile()` call actually
returns for this scenario. It returns `drifted` at `"reservations"` (ascending-path priority among several
real drifted paths, exactly as `lib/reconcile/reconcile.ts`'s own header documents — confirmed independently
against `npm run demo:domains`'s own INV-2 output). The page shows BOTH: the whole pipeline's real answer
(`"reservations"` drifted), and a second, real `reconcile()` call sliced to `stock.reserved` alone — the
documented mechanism for seeing a second fact the frozen `Reconciliation` type can't carry in one call. Beats
6–7 below walk both, in the order they appear on screen.

| # | Time | What to click / point at | What to say |
|---|------|---------------------------|--------------|
| 1 | 0:00–0:07 (7s) | Load the page. Point at the World card: `SKU-77021`, `reserved 37`, `available 113`, `fingerprint e4bd0b35`. | "This is a real stock record. Everything below runs the actual engine, client-side — no server, no mock." |
| 2 | 0:07–0:17 (10s) | Click **Simulate**. Point at the Projected effect card — `stock.reserved 37 → 42`, `stock.available 113 → 108`, `reservations` append — and the two assumption chips underneath. | "Simulate runs the real `project()` function. It predicts three changes, and names exactly what it's assuming to make that prediction — `no-concurrent-writer`, `world-version-unchanged`." |
| 3 | 0:17–0:28 (11s) | Click **Execute** — no injection yet. Point at the Observed effect (the identical three numbers), the green **"Confirmed — every predicted change matched (3 delta(s))"** badge, then the greyed **"Rollback — available, unused."** | "Execute runs the real write. Nothing else touched this record, so the prediction and reality match exactly — confirmed. There's a real rollback plan sitting right here, computed and ready — it just never had to run." |
| 4 | 0:28–0:35 (7s) | Click **Reset to T0**, then **Simulate** again. Point at the identical Projected effect card. | "Same reset, same action, same simulate call — same three predicted changes. Now watch what happens when something else writes to this record in between." |
| 5 | 0:35–0:44 (9s) | Click **Inject concurrent change**. Point at the World card ticking — `reserved 37 → 40`, `available 113 → 110` — and the real-write log line underneath it. | "That's a second, real order — `ord-5534` — reserving 3 units for real, right now, through the same domain code every other write here goes through. The world just changed under us." |
| 6 | 0:44–0:56 (12s) | Click **Execute**. Point at the World card — back to the SAME numbers as step 5 (`40`, `110`, `d0707049`) — then at the Observed effect and the red **"Drifted"** badge with its `reservations` predicted/actual rows. | "Execute runs against whatever is really there now, not what simulate saw. The system catches it immediately — drifted. Look at the World card, though: once rollback finishes, it's back to exactly what it was right after the injection. Rollback undid only this action's own write." |
| 7 | 0:56–1:07 (11s) | Point at the **"stock.reserved, on its own"** card — `stock.reserved — drifted`, `predicted: 42`, `actual: 45`. | "`reconcile()` only reports one fact per call, and `reservations` sorted first this time — so this card runs the same real `reconcile()` a second time, sliced to just this field, to show the exact number the plan talks about: predicted 42, actually 45." |
| 8 | 1:07–1:18 (11s) | Point at the auto-expanded rollback steps, then the **"Restored ✓ — every field matches"** badge and the two fingerprints, `d0707049` and `d0707049`. | "The rollback already ran — four real, inverted steps, through the same generic interpreter every write in this demo uses. And the verdict: restored, every field, checked structurally — not just because the hash happens to match." |
| 9 | 1:18–1:28 (10s) | Click **"Why isn't the hash the proof?"** open. Point at the collision fact, then at **"ord-5534's reservation (`res-9035`) — untouched, qty 3."** | "Because a hash can lie — two different states in this exact project's own inventory field share one. So the checkmark never trusts it alone. And this line is the real point of the whole demo: the OTHER order's reservation was never touched by this rollback at all." |
| 10 | 1:28–1:35 (7s) | Point at the SimulatorTrust line: **`0 → 1 (flips a stricter mode at 3)`**. | "One drift, and the trust counter moves — a real gate, watching, though it takes three in a row before it actually bites." |
| 11 | 1:35–1:42 (7s) | Point at **Inject concurrent change** — still enabled before any Execute click on a fresh run — and mention clicking it repeatedly. | "That inject button stays clickable as many times as you want, before you execute — click it three times and the drift scales linearly, for real. Nothing here is a canned number." |

**Total: ~102 seconds.**

**The one line worth protecting if time runs short:** Beat 9's — *"the OTHER order's reservation was never
touched by this rollback at all."* Per this design's own §6 argument, that absence is the one fact a stranger
cannot conclude just from watching numbers change (nothing about `res-9035` visibly changes, because
correctly, nothing happened to it) — it is the single deliberate exception to "show, don't narrate" in the
whole design, and it is the detail that most separates this from a plain diff tool.

**What this script does not claim:** Beat 11 describes the self-evidence test in prose rather than performing
a second full run inside the same continuous take — actually clicking Inject two or three times before
Execute (verified live while building this page: a second click adds its own real +3, landing on a
fresh, real fingerprint, with both injected reservations later confirmed untouched after rollback) is a real,
available demonstration, just one beat this particular 100-second cut chooses to describe rather than perform
a second time. A presenter with a few extra seconds should just do it live instead of saying the line.
