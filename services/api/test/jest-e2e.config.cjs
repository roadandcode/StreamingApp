/** End-to-end tests: the full Nest app against PostgreSQL (streaming_test), run in band. */
const base = require('./jest-base.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testRegex: 'test/e2e/.*\\.e2e-spec\\.ts$',
  setupFiles: ['<rootDir>/test/support/e2e-env.cjs'],
  testTimeout: 60_000,
  maxWorkers: 1,
};
