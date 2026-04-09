import nextConfig from 'eslint-config-next/core-web-vitals';
import nextTsConfig from 'eslint-config-next/typescript';

const eslintConfig = [
  ...nextConfig,
  ...nextTsConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default eslintConfig;
