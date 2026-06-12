process.env.SERVICE_NAME = 'document-service';

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
    '!**/common/kafka/kafka-consumer*',
    '!**/common/org-client/**',
    '!**/common/storage/**',
    '!**/common/extractor-client/**',
    '!**/typologies/internal-typologies.controller.{ts,js}',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  // Root node_modules as absolute path so packages loaded from packages/common/src/
  // (outside rootDir) can always find their hoisted deps (rxjs, @nestjs/common, etc.)
  modulePaths: ['<rootDir>/../../../node_modules'],
  moduleDirectories: ['node_modules', '<rootDir>/../node_modules'],
  moduleNameMapper: {
    '^@sgd/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@sgd/common/(.*)$': '<rootDir>/../../../packages/common/src/$1',
    // Mock the two packages imported by tracing.ts.  Their deeply-nested
    // transitive deps hit Windows MAX_PATH limits and ESM-in-CJS conflicts
    // that crash Jest's resolver.  initTracing() is a no-op in tests anyway
    // (it guards on OTEL_EXPORTER_OTLP_ENDPOINT which is never set in CI).
    '^@opentelemetry/auto-instrumentations-node$': '<rootDir>/__mocks__/otel-auto-instrumentations-noop.js',
    '^@opentelemetry/sdk-node$': '<rootDir>/__mocks__/otel-sdk-noop.js',
    '^@opentelemetry/exporter-trace-otlp-http$': '<rootDir>/__mocks__/otel-exporter-noop.js',
  },
  coverageThreshold: { global: { statements: 85, lines: 85 } },
  forceExit: true,
};
