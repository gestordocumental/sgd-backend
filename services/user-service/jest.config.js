process.env.SERVICE_NAME = 'user-service';

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
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
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@sgd/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@sgd/common/(.*)$': '<rootDir>/../../../packages/common/src/$1',
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
