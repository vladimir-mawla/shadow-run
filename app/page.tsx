/**
 * Placeholder root page — infrastructure only. The interactive demo is
 * M8's job (see .genesis/PLAN.md); this exists purely so the Next.js app
 * shell has a real route to build and serve before then.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>shadow-run</h1>
      <p>Simulate before you act. The interactive demo lands at M8 — see the README.</p>
    </main>
  );
}
