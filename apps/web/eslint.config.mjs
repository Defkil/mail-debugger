import prettier from 'eslint-config-prettier/flat';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    // Svelte components are named in PascalCase.
    files: ['**/*.svelte'],
    rules: {
      'unicorn/filename-case': [
        'error',
        { cases: { kebabCase: true, pascalCase: true } },
      ],
    },
  },
  ...svelte.configs.prettier,
  // Must stay last: turns off the rules that conflict with Prettier.
  prettier,
];
