import nx from '@nx/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  eslintPluginUnicorn.configs.recommended,
  {
    ignores: [
      '**/dist',
      '**/dist-api',
      '**/out-tsc',
      '**/.svelte-kit',
      '**/build',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            String.raw`^.*/eslint(\.base)?\.config\.[cm]?[jt]s$`,
            String.raw`^.*/vitest\.config\.base(\.[jt]s)?$`,
          ],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    // Applies to every linted file, including .svelte and .json files.
    rules: {
      'unicorn/no-null': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/prefer-top-level-await': 'off',
      // Successor of prevent-abbreviations, which this project never used.
      'unicorn/name-replacements': 'off',
      // The following rules conflict with conventions of the libraries and
      // frameworks in use: Rezi UI and TypeBox schemas are nested builder
      // calls, config files and singletons are module side effects, Svelte 5
      // state and Vitest fixtures are reassigned from functions, SvelteKit
      // requires names such as `ssr`, and TSDoc comments use `/** ... */`.
      'unicorn/max-nested-calls': 'off',
      'unicorn/no-top-level-side-effects': 'off',
      'unicorn/no-top-level-assignment-in-function': 'off',
      'unicorn/consistent-boolean-name': 'off',
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      'unicorn/single-line-block-comment-style': 'off',
    },
  },
  // Must stay last: turns off the rules that conflict with Prettier.
  prettier,
];
