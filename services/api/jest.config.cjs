/** Unit tests: pure functions and services with in-memory collaborators. No database. */
const base = require('./test/jest-base.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testRegex: 'src/.*\\.spec\\.ts$',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts'],
  coverageDirectory: './coverage',
};
