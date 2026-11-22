// Server ESLint: the shared type-checked base from @repo/config. The project service picks the
// nearest tsconfig per file (src → tsconfig.json, test → test/tsconfig.json).
import base from '@repo/config/eslint';

export default [
  ...base,
  { ignores: ['dist/**', '*.js', '*.mjs'] },
  {
    // Jest mocks are typed `any` (`mock.calls[0][0]`) and assert on unbound methods
    // (`expect(service.method).toHaveBeenCalled()`); app code keeps the full rule set.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
];
