export default [
  {
    ignores: ['node_modules/**', 'scan-results/**', 'coverage/**', 'fixtures/**'],
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-constant-binary-expression': 'error',
      'valid-typeof': 'error',
    },
  },
];
