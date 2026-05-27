process.env.SERVICE_NAME = 'auth-service';

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@sgd/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@sgd/common/(.*)$': '<rootDir>/../../../packages/common/src/$1',
  },
  moduleDirectories: [
    'node_modules',
    '<rootDir>/../node_modules',
  ],
  collectCoverageFrom: [
    '**/*.{ts,js}',
    '!**/*.spec.{ts,js}',
    '!**/migrations/**',
    '!**/*.entity.{ts,js}',
    '!**/*.module.{ts,js}',
    '!main.{ts,js}',
    '!data-source.{ts,js}',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  coverageThreshold: {
    global: {
      statements: 85,
      lines: 85,
    },
  },
};
