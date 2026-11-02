// Codes de salon.
const crypto = require('node:crypto');

// Code de salon aléatoire, du type « k7p2-x9qd-4mzt-wb3h » (80 bits).
function newRoomCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return chars.match(/.{4}/g).join('-');
}

function normalizeCode(text) {
  const code = String(text ?? '').trim().toLowerCase();
  return /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/.test(code) ? code : null;
}

module.exports = { newRoomCode, normalizeCode };
