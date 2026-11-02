const test = require('node:test');
const assert = require('node:assert/strict');
const { clamp, parseNumber, sanitizeZone } = require('../src/main/util');

test('clamp borne la valeur et remplace un non-nombre par le minimum', () => {
  assert.equal(clamp(5, 1, 10), 5);
  assert.equal(clamp(50, 1, 10), 10);
  assert.equal(clamp(-3, 1, 10), 1);
  assert.equal(clamp('abc', 1, 10), 1);
});

test('parseNumber renvoie null pour un champ vide ou invalide', () => {
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('   '), null);
  assert.equal(parseNumber(undefined), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('42'), 42);
  assert.equal(parseNumber(0), 0);
});

test('sanitizeZone garde la zone dans l’écran', () => {
  assert.deepEqual(sanitizeZone({ x: 0, y: 0, width: 1, height: 1 }), { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(sanitizeZone({ x: 0.5, y: 0.5, width: 0.9, height: 0.9 }), { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  const z = sanitizeZone({ x: -1, y: 'a', width: 0, height: 0 });
  assert.equal(z.x, 0);
  assert.equal(z.y, 0);
  assert.equal(z.width, 0.02);
  assert.equal(z.height, 0.02);
});
