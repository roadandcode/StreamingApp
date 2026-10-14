const path = require('node:path');

const root = path.resolve(__dirname, '..');

/**
 * Shared Jest settings. TypeScript sources go through ts-jest; ESM-only packages in node_modules
 * (NestJS 12) are compiled to CommonJS by a small transformer, see support/esm-to-cjs-transformer.cjs.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: root,
  moduleFileExtensions: ['ts', 'js', 'mjs', 'cjs', 'json'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(root, 'tsconfig.json') }],
    '^.+\\.m?js$': path.join(root, 'test/support/esm-to-cjs-transformer.cjs'),
  },
  transformIgnorePatterns: ['\\.pnp\\.[^\\/]+$'],
};
