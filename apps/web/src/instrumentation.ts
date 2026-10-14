/**
 * Validates the server configuration once when the server starts, so a missing or weak
 * SESSION_COOKIE_SECRET (or any other bad value) stops the process instead of failing per request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateConfigOnStartup } = await import("./lib/startup");
    validateConfigOnStartup();
  }
}
