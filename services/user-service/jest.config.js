process.env.SERVICE_NAME = 'user-service';

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // Pact tests run separately via jest.pact.config.js
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['\\.pact\\.spec\\.ts$', '\\.provider\\.spec\\.ts$'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.{ts,js}',
    '!**/*.d.ts',
    '!**/*.spec.{ts,js}',
    '!**/migrations/**',
    '!**/*.entity.{ts,js}',
    '!**/*.module.{ts,js}',
    '!main.{ts,js}',
    '!data-source.{ts,js}',
    '!instrument.{ts,js}',
    '!**/common/correlation/**',
    '!**/common/decorators/**',
    '!**/common/filters/**',
    '!**/common/guards/**',
    '!**/common/interceptors/**',
    '!**/common/kafka/**',
    '!**/common/logger/**',
    '!**/common/metrics/**',
    '!**/common/middleware/**',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@sgd/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@sgd/common/(.*)$': '<rootDir>/../../../packages/common/src/$1',
    '^@opentelemetry/auto-instrumentations-node$': '<rootDir>/__mocks__/otel-auto-instrumentations-noop.js',
    '^@opentelemetry/sdk-node$': '<rootDir>/__mocks__/otel-sdk-noop.js',
    '^@opentelemetry/exporter-trace-otlp-http$': '<rootDir>/__mocks__/otel-exporter-noop.js',
  },
  moduleDirectories: [
    'node_modules',
    '<rootDir>/../node_modules',
  ],
  setupFiles: ['reflect-metadata'],
  forceExit: true,
  coverageThreshold: {
    global: {
      statements: 85,
      lines: 85,
    },
  },
};
