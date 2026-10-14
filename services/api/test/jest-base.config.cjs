const path = require('node:path');

const root = path.resolve(__dirname, '..');

/**
 * Shared Jest settings. TypeScript sources go through ts-jest.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: root,
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(root, 'tsconfig.json') }],
  },
};
