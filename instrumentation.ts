// Runs once when the server starts. The Node.js-only part (database, scheduler) is in its own file and
// imported inside the NEXT_RUNTIME check, so the edge build never bundles it.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
