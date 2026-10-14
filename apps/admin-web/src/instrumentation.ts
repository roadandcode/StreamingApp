/** Runs once when the server starts: refuse to boot with an invalid configuration. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateConfigOrExit } = await import("./instrumentation-node");
    validateConfigOrExit();
  }
}
