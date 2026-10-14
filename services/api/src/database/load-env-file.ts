import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads `services/api/.env` into `process.env` for the standalone scripts (migrate, seed, OpenAPI
 * emit). Variables already set in the environment win, matching @nestjs/config.
 */
export function loadEnvFile(): void {
  const path = resolve(__dirname, '../../.env');
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}
