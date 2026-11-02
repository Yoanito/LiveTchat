// Salon : fenêtre réseau invisible (WebRTC), membres, envoi et réception des médias.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { MEDIA_EXT, MAX_TEXT_LENGTH } = require('../protocol');
const { clamp } = require('./util');
const settings = require('./settings');

let win = null;
let notify = () => {};
let enqueue = () => {};

// Salon courant (null si je ne suis dans aucun salon).
let room = null;
const pendingSends = new Map();
let recvDir = null;

// Fenêtre invisible qui porte la connexion directe (WebRTC) avec les autres membres.
function createWindow() {
  win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-net.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'net', 'net.html'));
}

function command(cmd) {
  if (win && !win.isDestroyed()) win.webContents.send('net:command', cmd);
}

function notifyRoom() {
  notify('room:changed', room);
}

function myName() {
  return settings.get().name || os.userInfo().username;
}

function get() {
  return room;
}

function join(code) {
  settings.ensureClientId();
  leave();
  const s = settings.get();
  recvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'livetchat-recv-'));
  s.lastCode = code;
  settings.save();
  room = { code, members: [], warning: null };
  command({
    type: 'join',
    code,
    id: s.clientId,
    name: myName(),
    maxSizeMb: s.maxSizeMb,
    // Pour les tests : relais Nostr personnalisés, séparés par des virgules.
    relayUrls: process.env.LIVETCHAT_RELAYS?.split(',').filter(Boolean),
  });
  notifyRoom();
}

function leave() {
  if (!room) return;
  command({ type: 'leave' });
  room = null;
  for (const { resolve } of pendingSends.values()) resolve({ ok: false, error: 'Salon quitté.' });
  pendingSends.clear();
  const dir = recvDir;
  recvDir = null;
  if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
  notifyRoom();
}

function setLimit(maxSizeMb) {
  command({ type: 'limit', maxSizeMb });
}

function receiveMedia({ bytes, ext, text, imageSeconds, from }) {
  const s = settings.get();
  if (!room || !recvDir || !(bytes instanceof Uint8Array)) return;
  if (s.muted.includes(from?.id)) return;
  const safeExt = String(ext ?? '').toLowerCase();
  if (!MEDIA_EXT.includes(safeExt)) return;
  if (bytes.byteLength > s.maxSizeMb * 1024 * 1024) return;
  const file = path.join(recvDir, crypto.randomUUID() + safeExt);
  fs.writeFile(file, bytes, (err) => {
    if (err) return;
    enqueue(file, { text, imageSeconds });
    // Effacé au bout de 10 minutes, largement après l'affichage.
    setTimeout(() => fs.rm(file, { force: true }, () => {}), 10 * 60_000).unref();
  });
}

async function send(file, { text, imageSeconds }) {
  if (!room) return { ok: false, error: "Tu n'es pas dans un salon." };
  const payload = {
    text: String(text ?? '').slice(0, MAX_TEXT_LENGTH),
    imageSeconds: clamp(imageSeconds, 1, 30),
  };
  // Je vois aussi ce que j'envoie.
  enqueue(file, payload);
  if (room.members.length === 0) return { ok: true, delivered: 0, skipped: [] };

  const bytes = await fs.promises.readFile(file);
  const requestId = crypto.randomUUID();
  const result = new Promise((resolve) => pendingSends.set(requestId, { resolve }));
  command({
    type: 'send',
    requestId,
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    ext: path.extname(file).toLowerCase(),
    ...payload,
  });
  return result;
}

ipcMain.on('net:event', (event, name, payload) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  if (name === 'members' && room) {
    room.members = payload.map((m) => ({ id: m.id, name: m.name }));
    notifyRoom();
  } else if (name === 'warning' && room) {
    room.warning = payload;
    notifyRoom();
  } else if (name === 'media') {
    receiveMedia(payload);
  } else if (name === 'sent') {
    const pending = pendingSends.get(payload.requestId);
    if (!pending) return;
    pendingSends.delete(payload.requestId);
    pending.resolve(payload);
  }
});

function init(deps) {
  notify = deps.notify;
  enqueue = deps.enqueue;
  createWindow();
}

module.exports = { init, get, join, leave, send, setLimit };
