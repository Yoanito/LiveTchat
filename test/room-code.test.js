const test = require('node:test');
const assert = require('node:assert/strict');
const { newRoomCode, normalizeCode } = require('../src/main/room-code');

test('newRoomCode a la forme k7p2-x9qd-4mzt-wb3h, sans caractères ambigus', () => {
  for (let i = 0; i < 200; i++) {
    const code = newRoomCode();
    assert.match(code, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    assert.doesNotMatch(code, /[ilo01]/);
  }
});

test('normalizeCode accepte les majuscules et les espaces autour', () => {
  assert.equal(normalizeCode('  K7P2-X9QD-4MZT-WB3H '), 'k7p2-x9qd-4mzt-wb3h');
  assert.equal(normalizeCode('k7p2x9qd4mztwb3h'), null);
  assert.equal(normalizeCode(''), null);
  assert.equal(normalizeCode(null), null);
});
