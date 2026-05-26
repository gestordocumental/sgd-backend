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
  moduleDirectories: ['node_modules', '<rootDir>/../node_modules'],
  moduleNameMapper: {
    '^@sgd/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@sgd/common/(.*)$': '<rootDir>/../../../packages/common/src/$1',
  },
  coverageThreshold: { global: { statements: 80, lines: 80 } },
  forceExit: true,
};
