/**
 * Next.js instrumentation hook. Runs once when the dev server boots.
 * Keeps the two local MeshSync agents alive as children of the server
 * process (dev only — production builds never spawn agents).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development") return;
  try {
    const { ensureAgents } = await import("./lib/agent-supervisor");
    // Small delay so the dev server is fully up before agents bind ports.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await ensureAgents();
  } catch (err) {
    console.error("[instrumentation] agent supervisor failed:", err);
  }
}
