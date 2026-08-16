const path = require('path');

/**
 * Jest config for the distributed fault-tolerance subsystem.
 * Isolated from the project's frontend jest config: runs in the Node
 * environment (not jsdom) and does not load jest-fetch-mock, so the failure
 * detector, database service, and health probe are tested as real Node modules.
 *
 * Run from the project root:
 *   npx jest --config distributed/jest.config.cjs
 */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  clearMocks: true,
  transform: {
    '^.+\\.m?js$': ['babel-jest', { configFile: path.resolve(__dirname, 'babel.config.cjs') }],
  },
  testMatch: ['<rootDir>/__tests__/**/*.test.js'],
};
