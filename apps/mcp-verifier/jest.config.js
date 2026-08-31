module.exports = {
  rootDir: '.',
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: ['<rootDir>/test/unit/**/*.test.{ts,tsx}'],
  moduleNameMapper: {
    '^@/lib/(.*)$': '<rootDir>/lib/$1',
    '^@/components/(.*)$': '<rootDir>/app/components/$1',
    '^@/src/(.*)$': '<rootDir>/../../src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.test.json',
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(lucide-react|@monaco-editor)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
};
