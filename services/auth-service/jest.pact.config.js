process.env.SERVICE_NAME = 'auth-service';

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '\\.(pact|provider)\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@sgd/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@sgd/common/(.*)$': '<rootDir>/../../../packages/common/src/$1',
    '^@opentelemetry/auto-instrumentations-node$': '<rootDir>/__mocks__/otel-auto-instrumentations-noop.js',
    '^@opentelemetry/sdk-node$': '<rootDir>/__mocks__/otel-sdk-noop.js',
  },
  moduleDirectories: [
    'node_modules',
    '<rootDir>/../node_modules',
  ],
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  testTimeout: 30_000,
  runInBand: true,
};
