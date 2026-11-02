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
let player = null;

// Salon courant (null si je ne suis dans aucun salon).
let room = null;
const pendingSends = new Map();
// Dossier des fichiers reçus : tempRoot\recv-xxxx, un par salon rejoint.
let tempRoot = null;
let recvDir = null;

// Retente l'effacement : sous Windows, un fichier encore ouvert ne s'efface pas tout de suite.
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 };

// Efface ce qu'une session précédente a laissé (plantage, extinction du PC…).
function cleanTemp() {
  try {
    fs.rmSync(tempRoot, RM_OPTIONS);
    // Anciennes versions : dossiers livetchat-recv-* directement dans %TEMP%.
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (name.startsWith('livetchat-recv-')) fs.rmSync(path.join(os.tmpdir(), name), RM_OPTIONS);
    }
  } catch (err) {
    console.error('Nettoyage des fichiers temporaires incomplet :', err.message);
  }
}

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

// Ce que la page réseau doit savoir de moi. muted reste local : il n'est envoyé à personne.
function profile() {
  const s = settings.get();
  return { id: s.clientId, name: myName(), maxSizeMb: s.maxSizeMb, muted: s.muted };
}

function join(code) {
  settings.ensureClientId();
  leave();
  const s = settings.get();
  fs.mkdirSync(tempRoot, { recursive: true });
  recvDir = fs.mkdtempSync(path.join(tempRoot, 'recv-'));
  s.lastCode = code;
  settings.save();
  room = { code, members: [], warning: null };
  command({
    type: 'join',
    code,
    ...profile(),
    // Pour les tests : relais Nostr personnalisés, séparés par des virgules.
    relayUrls: process.env.LIVETCHAT_RELAYS?.split(',').filter(Boolean),
  });
  notifyRoom();
}

// sync : à la fermeture de l'appli, qui n'attendrait pas un effacement en arrière-plan.
function leave({ sync = false } = {}) {
  if (!room) return;
  command({ type: 'leave' });
  room = null;
  for (const { resolve } of pendingSends.values()) resolve({ ok: false, error: 'Salon quitté.' });
  pendingSends.clear();
  const dir = recvDir;
  recvDir = null;
  if (dir) {
    // Les médias du salon encore en attente ou affichés partent avec lui.
    player.drop((item) => item.file.startsWith(dir + path.sep));
    if (sync) {
      try {
        fs.rmSync(dir, RM_OPTIONS);
      } catch (err) {
        console.error('Fichiers reçus non effacés :', err.message);
      }
    } else {
      fs.rm(dir, RM_OPTIONS, () => {});
    }
  }
  notifyRoom();
}

// Pseudo, limite ou liste des mutes changés : la page réseau prévient les autres si besoin.
function updateProfile() {
  if (room) command({ type: 'profile', ...profile() });
}

function receiveMedia({ bytes, ext, text, imageSeconds, from }) {
  const s = settings.get();
  if (!room || !recvDir || !(bytes instanceof Uint8Array)) return;
  if (s.muted.includes(from?.id)) return;
  const safeExt = String(ext ?? '').toLowerCase();
  if (!MEDIA_EXT.includes(safeExt)) return;
  if (bytes.byteLength > s.maxSizeMb * 1024 * 1024) return;
  const dir = recvDir;
  const file = path.join(dir, crypto.randomUUID() + safeExt);
  fs.writeFile(file, bytes, (err) => {
    if (err) return;
    // Salon quitté pendant l'écriture.
    if (recvDir !== dir) return fs.rm(file, RM_OPTIONS, () => {});
    // Effacé dès qu'il a été affiché (ou ignoré si la file est pleine).
    player.enqueue(file, { text, imageSeconds, onDone: () => fs.rm(file, RM_OPTIONS, () => {}) });
  });
}

async function send(file, { text, imageSeconds }) {
  if (!room) return { ok: false, error: "Tu n'es pas dans un salon." };
  const payload = {
    text: String(text ?? '').slice(0, MAX_TEXT_LENGTH),
    imageSeconds: clamp(imageSeconds, 1, 30),
  };
  // Je vois aussi ce que j'envoie.
  player.enqueue(file, payload);
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
  player = deps.player;
  tempRoot = deps.tempRoot;
  cleanTemp();
  createWindow();
}

module.exports = { init, get, join, leave, send, updateProfile };
