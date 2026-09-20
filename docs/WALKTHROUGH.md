# 90-second walkthrough script

Built around the live demo on `/` (`components/InventoryDemo.tsx`, driven with `npm run dev`). No deployed
URL exists on this branch yet — the same script will work identically once one does, for the reason
`app/page.tsx`'s own on-screen copy states and this project's `node:`-free production files confirm directly:
the whole pipeline (`simulate()`, `reconcile()`, `runRollback()`, `inventoryDomain.applyReal()`) runs
client-side, reads no network state, and is verified here against this branch's own real output. One
continuous take. Every number and every line of copy below was read off an actual run of this exact branch —
nothing here is the design doc's aspirational phrasing re-typed without checking it against a real run.

**A real finding this script had to account for, not paper over:** `sim-plan.md` §B's own headline sentence —
"stock.reserved: predicted 42, observed 45" — is NOT what the whole-pipeline `reconcile()` call actually
returns for this scenario. It returns `drifted` at `"reservations"` (ascending-path priority among several
real drifted paths, exactly as `lib/reconcile/reconcile.ts`'s own header documents — confirmed independently
against `npm run demo:domains`'s own INV-2 output, and against M7's own Case 1 pin). The page shows BOTH: the
whole pipeline's real answer (`"reservations"` drifted), and a second, real `reconcile()` call sliced to
`stock.reserved` alone — the documented mechanism for seeing a second fact the frozen `Reconciliation` type
can't carry in one call. Beat 6 below is that second card; it is not cut for time, because a judge needs to
see the system reported `"reservations"` AND that `stock.reserved: 42 → 45` came from a second, documented
call — not one or the other.

| # | Time | What to click / point at | What to say |
|---|------|---------------------------|--------------|
| 1 | 0:00–0:07 (7s) | Load the page. Point at the World card: `SKU-77021`, `reserved 37`, `available 113`, `fingerprint e4bd0b35`. | "A real stock record. Everything below runs the actual engine, client-side — no server, no mock." |
| 2 | 0:07–0:16 (9s) | Click **Simulate**. Point at the Projected effect card — `37 → 42`, `113 → 108`, `reservations` append — and the two assumption chips. | "Simulate predicts three real changes, and names what it's assuming to make that prediction." |
| 3 | 0:16–0:26 (10s) | Click **Execute** — no injection yet. Point at the matching Observed effect, the green **"Confirmed — every predicted change matched (3 delta(s))"** badge, and the greyed **"Rollback — available, unused."** | "Nothing else touched this record — prediction and reality match. There's a real rollback plan sitting right here, computed and ready. It just never had to run." |
| 4 | 0:26–0:35 (9s) | Click **Reset to T0**, **Simulate**, then **Inject concurrent change**. Point at the World card ticking — `37 → 40`, `113 → 110` — and the real-write log line. | "Same action. Now a second, real order — `ord-5534` — reserves 3 units for real, right now, through the same domain code. The world just changed under us." |
| 5 | 0:35–0:47 (12s) | Click **Execute**. Point at the World card — back to the SAME numbers as step 4 (`40`, `110`, `d0707049`) — then the red **"Drifted"** badge with its `reservations` rows. | "Execute runs against what's really there, not what Simulate saw. Caught immediately — drifted. And the World card: once rollback finishes, it's already back to exactly what it was after the injection. Rollback undid only this action's own write." |
| 6 | 0:47–0:59 (12s) | Point at the **"stock.reserved, on its own"** card — `stock.reserved — drifted`, `predicted: 42`, `actual: 45`. | "`reconcile()` reports one fact per call, and `reservations` sorted first. This card is the same real `reconcile()`, called again, sliced to just this field — the exact number the plan talks about." |
| 7 | 0:59–1:13 (14s) | Point at the auto-expanded rollback steps, the **"honesty check... PASS"** chip, then **"Restored ✓ — every field matches"** and the two fingerprints, `d0707049` / `d0707049`. Click **"Why isn't the hash the proof?"** open. | "Four real inverted steps, checked two independent ways before and after running. Restored, checked structurally — not because the hash matches. It matters: two different states in this project's own inventory field share one hash. The checkmark never trusts it alone." |
| 8 | 1:13–1:30 (17s) | Point at **"ord-5534's reservation (`res-9035`) — untouched, qty 3"** and the SimulatorTrust line, `0 → 1`. | "The other order's reservation was never touched by this rollback — the real point of the whole demo. And the trust counter moved too. One more thing: that Inject button stays clickable as many times as you want before Execute — click it three times and the drift scales linearly, for real." |

**Total: 90 seconds.**

**The one line worth protecting if time runs short:** Beat 8's — *"the other order's reservation was never
touched by this rollback."* Per this design's own §6 argument, that absence is the one fact a stranger cannot
conclude just from watching numbers change (nothing about `res-9035` visibly changes, because correctly,
nothing happened to it) — the single deliberate exception to "show, don't narrate" in the whole design, and
the detail that most separates this from a plain diff tool.

**What this script does not claim:** the repeated-inject self-evidence test is now one sentence inside beat 8,
not its own beat — it is a skeptic's check, not the story, and cutting it to a sentence is what made room for
the two beats that must not be cut (6 and 8). Actually clicking Inject two or three times before Execute
(verified live: a second click adds its own real +3, landing on a fresh, real fingerprint, with every
injected reservation confirmed untouched after rollback) is real and available — a presenter with a spare
moment should do it live rather than only say the line.
