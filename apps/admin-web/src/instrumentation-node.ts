import { getServerEnv } from "./lib/env";

/** Validates the server configuration; exits the process with a clear message when it is invalid. */
export function validateConfigOrExit(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  try {
    getServerEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
