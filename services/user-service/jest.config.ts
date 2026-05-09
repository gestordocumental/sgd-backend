import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.{ts,js}$': 'ts-jest',
  },
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
  forceExit: true,
  coverageThreshold: {
    global: {
      statements: 85,
      lines: 85,
    },
  },
};

export default config;
