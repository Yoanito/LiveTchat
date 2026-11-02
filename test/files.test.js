const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkFile, mediaKind } = require('../src/main/files');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livetchat-test-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('mediaKind reconnaît les formats acceptés, en majuscules aussi', () => {
  assert.equal(mediaKind('a.PNG'), 'image');
  assert.equal(mediaKind('a.webm'), 'video');
  assert.equal(mediaKind('a.exe'), null);
});

test('checkFile vérifie le format, l’existence et la taille', () => {
  const small = path.join(dir, 'petit.png');
  fs.writeFileSync(small, Buffer.alloc(1000));
  const big = path.join(dir, 'gros.mp4');
  fs.writeFileSync(big, Buffer.alloc(2 * 1024 * 1024));
  assert.deepEqual(checkFile(small, 1), { size: 1000, kind: 'image' });
  assert.match(checkFile(big, 1).error, /trop lourd/);
  assert.match(checkFile(path.join(dir, 'absent.png'), 1).error, /introuvable/);
  assert.match(checkFile(path.join(dir, 'x.txt'), 1).error, /Format/);
  assert.match(checkFile(null, 1).error, /Choisis/);
});
