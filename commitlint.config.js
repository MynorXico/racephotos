/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scopes map to the services and layers in this repo
    'scope-enum': [
      2,
      'always',
      [
        // Lambdas
        'photo-upload',
        'photo-processor',
        'watermark',
        'search',
        'payment',
        // Shared
        'shared',
        // Infrastructure
        'cdk',
        'ci',
        // Frontend
        'frontend',
        'frontend-shell',
        'frontend-search',
        'frontend-purchase',
        'frontend-photographer',
        // Documentation
        'adr',
        'docs',
        'stories',
        // Tooling / repo-wide
        'deps',
        'config',
        'release',
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 100],
  },
};
