process.env.SERVICE_NAME = 'metadata-extractor-service';

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: [
    '**/*.{ts,js}',
    '!**/*.spec.{ts,js}',
    '!**/*.module.{ts,js}',
    '!main.{ts,js}',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  moduleDirectories: ['node_modules', '<rootDir>/../node_modules'],
  moduleNameMapper: {
    '^@sgd/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@sgd/common/(.*)$': '<rootDir>/../../../packages/common/src/$1',
    '^@opentelemetry/auto-instrumentations-node$': '<rootDir>/__mocks__/otel-auto-instrumentations-noop.js',
    '^@opentelemetry/sdk-node$': '<rootDir>/__mocks__/otel-sdk-noop.js',
    '^@opentelemetry/exporter-trace-otlp-http$': '<rootDir>/__mocks__/otel-exporter-noop.js',
  },
  coverageThreshold: { global: { statements: 85, lines: 85 } },
  forceExit: true,
};
