import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.spec.(t|j)s',
    '!**/migrations/**',
    '!**/*.entity.(t|j)s',
    '!**/*.module.(t|j)s',
    '!main.(t|j)s',
    '!data-source.(t|j)s',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  forceExit: true,
  coverageThreshold: {
    global: {
      statements: 85,
      lines: 85,
    },
  },
};

export default config;
