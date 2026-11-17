import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['src/**/*.ts', 'test/**/*.ts'];
const javascriptFiles = ['scripts/**/*.mjs', '*.mjs', '*.cjs'];

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  { ...js.configs.recommended, files: javascriptFiles },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: typescriptFiles })),
  {
    files: [...typescriptFiles, ...javascriptFiles],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true },
      ],
    },
  },
);
