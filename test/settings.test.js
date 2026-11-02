const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, DEFAULTS } = require('../src/main/settings');
const { MAX_FILE_MB } = require('../src/protocol');

test('normalize donne les réglages par défaut pour un fichier vide ou cassé', () => {
  assert.deepEqual(normalize({}), DEFAULTS);
  assert.deepEqual(normalize(null), DEFAULTS);
  assert.deepEqual(normalize('pas un objet'), DEFAULTS);
});

test('normalize remet les valeurs dans les bornes', () => {
  const s = normalize({ volume: 7, opacity: 0, maxSizeMb: 500, muted: ['a', 3, null], displayId: 'x', sound: false });
  assert.equal(s.volume, 1);
  assert.equal(s.opacity, 0.1);
  assert.equal(s.maxSizeMb, MAX_FILE_MB);
  assert.deepEqual(s.muted, ['a']);
  assert.equal(s.displayId, null);
  assert.equal(s.sound, false);
});

test('normalize garde un identifiant d’écran et un identifiant client valides', () => {
  const s = normalize({ displayId: 2528732444, clientId: 'abc' });
  assert.equal(s.displayId, 2528732444);
  assert.equal(s.clientId, 'abc');
});
