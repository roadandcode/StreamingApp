import { ConfigError, getConfig } from "./config";

/** Node.js only (see instrumentation.ts): exit on invalid configuration, warn on risky settings. */
export function validateConfigOnStartup(): void {
  try {
    const config = getConfig();
    if (config.isProduction && config.fakeBilling) {
      console.warn("NEXT_PUBLIC_FAKE_BILLING is on in a production build; the API must refuse fake purchases.");
    }
    if (config.isProduction && !config.requireDrm) {
      console.warn("REQUIRE_DRM is off: playback without DRM is allowed. Turn it on once DRM is live.");
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
