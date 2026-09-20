# Provable undo, not confident prediction

Within two years, the useful question about an autonomous write stops being "did the agent predict
correctly" and becomes "can anyone replay the undo." This project's mechanism — a projection and a
compensation expressed as the same typed array of deltas, applied by one small interpreter — turns both
claims from sentences to trust into data to re-run. Today's "undo" is an uninspectable closure, or a
narrated claim checkable only by asking the agent again.

What this makes possible: a third party — not the operator, not the model that acted — can take a recorded
pre-state and a recorded steps array and mechanically prove, by structural equality, whether a rollback
restored what it claims. The proof has to be structural, not hash-based: this codebase's inventory field has
two legitimately different values colliding under the same 32-bit hash every snapshot carries. Trusting the
hash alone would have called a wrong restoration "restored."

The claim worth disagreeing with: static reversibility classification — labeling an action type "reversible"
before anything runs — loses ground to this recorded, replayable kind, because a classification is asserted
once, while a rollback record is checked every time it is used.

This fails if the world doesn't cooperate. Most consequential writes — a message read, a unit already
resold — have no honest inverse expressible as a value; if that fraction stays large, escalation, not
replay, carries the actions that matter most. And the guard keeping this honest took real pressure to earn,
not a first draft: the check policing "never reaches an LLM or the network" took seven bypasses across three
rounds before it separated what it prevents from what it only discloses. Provable undo is a property of a
system that survives that pressure, not a one-time design claim.
