// Vérification du code : npm run lint.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/', 'node_modules/', 'src/net/peer.bundle.js'] },
  js.configs.recommended,
  {
    // Processus principal, ponts (preload) et tests : Node, CommonJS.
    files: ['eslint.config.js', 'src/main.js', 'src/main/**/*.js', 'src/protocol.js', 'src/preload-*.js', 'test/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // Pages : navigateur, scripts classiques.
    files: ['src/control.js', 'src/overlay.js', 'src/zone.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    // Page réseau : module empaqueté par esbuild.
    files: ['src/net/peer.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
];
