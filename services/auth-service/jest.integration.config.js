process.env.SERVICE_NAME = 'auth-service';

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',
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
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  // Integration tests can be slow (real DB + Redis); allow 60 s per test
  testTimeout: 60_000,
};
