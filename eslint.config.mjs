import nx from '@nx/eslint-plugin';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  eslintPluginUnicorn.configs['flat/recommended'],
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
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      'unicorn/no-null': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/prefer-top-level-await': 'off',
    },
  },
];
