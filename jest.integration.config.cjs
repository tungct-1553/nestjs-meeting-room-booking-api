module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.integration.spec.ts'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  clearMocks: true,
};
