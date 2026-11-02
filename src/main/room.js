// Salon : fenêtre réseau invisible (WebRTC), membres, envoi et réception des médias.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { MEDIA_EXT, MAX_TEXT_LENGTH, DEFAULT_IMAGE_SECONDS } = require('../protocol');
const { clamp, parseNumber } = require('./util');
const settings = require('./settings');

const MB = 1024 * 1024;

let win = null;
// La page réseau est chargée et peut recevoir des commandes.
let ready = false;
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
  // Chargée (ou rechargée après un plantage) : on rejoint le salon en cours.
  win.webContents.on('did-finish-load', () => {
    ready = true;
    if (room) sendJoin();
  });
  // Page plantée : les envois en cours échouent, les membres réapparaîtront après le rechargement.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error("La connexion réseau s'est arrêtée :", details.reason);
    ready = false;
    failPendingSends('La connexion a redémarré, renvoie le média.');
    if (room) {
      room.members = [];
      room.warnings = [];
      notifyRoom();
    }
    setTimeout(() => win && !win.isDestroyed() && win.webContents.reload(), 1000);
  });
  win.loadFile(path.join(__dirname, '..', 'net', 'net.html'));
}

// Une commande envoyée avant la fin du chargement serait perdue : le salon est rejoint au chargement.
function command(cmd) {
  if (ready && win && !win.isDestroyed()) win.webContents.send('net:command', cmd);
}

function failPendingSends(error) {
  for (const { resolve } of pendingSends.values()) resolve({ ok: false, error });
  pendingSends.clear();
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

function sendJoin() {
  command({
    type: 'join',
    code: room.code,
    ...profile(),
    // Pour les tests : relais Nostr personnalisés, séparés par des virgules.
    relayUrls: process.env.LIVETCHAT_RELAYS?.split(',').filter(Boolean),
  });
}

function join(code) {
  settings.ensureClientId();
  leave();
  const s = settings.get();
  fs.mkdirSync(tempRoot, { recursive: true });
  recvDir = fs.mkdtempSync(path.join(tempRoot, 'recv-'));
  s.lastCode = code;
  settings.save();
  room = { code, members: [], warnings: [] };
  sendJoin();
  notifyRoom();
}

// sync : à la fermeture de l'appli, qui n'attendrait pas un effacement en arrière-plan.
function leave({ sync = false } = {}) {
  if (!room) return;
  command({ type: 'leave' });
  room = null;
  failPendingSends('Salon quitté.');
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
  if (bytes.byteLength > s.maxSizeMb * MB) return;
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

// Lit le fichier et le confie à la page réseau. Une fois la fonction terminée,
// le contenu n'est plus gardé en mémoire ici pendant le transfert.
async function transmit(file, requestId, targets, payload) {
  const bytes = await fs.promises.readFile(file);
  command({
    type: 'send',
    requestId,
    targets,
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    ext: path.extname(file).toLowerCase(),
    ...payload,
  });
}

// Envoie un média à chaque membre qui l'accepte. Le résultat est donné par ami.
async function send(file, size, { text, imageSeconds }) {
  if (!room) return { ok: false, error: "Tu n'es pas dans un salon." };
  const payload = {
    text: String(text ?? '').slice(0, MAX_TEXT_LENGTH),
    imageSeconds: clamp(parseNumber(imageSeconds) ?? DEFAULT_IMAGE_SECONDS, 1, 30),
  };
  // Je vois aussi ce que j'envoie.
  const shownHere = player.enqueue(file, payload) !== null;
  const members = room.members;
  const targets = members.filter((m) => size <= m.maxSizeMb * MB);
  const skipped = members.filter((m) => !targets.includes(m)).map((m) => m.name);
  // Personne ne peut le recevoir : inutile de lire le fichier.
  if (targets.length === 0) return { ok: true, delivered: [], failed: [], skipped, shownHere };
  if (!ready) return { ok: false, error: 'La connexion redémarre, réessaie dans quelques secondes.' };

  const requestId = crypto.randomUUID();
  const result = new Promise((resolve) => pendingSends.set(requestId, { resolve }));
  try {
    await transmit(file, requestId, targets.map((m) => m.peerId), payload);
  } catch (err) {
    pendingSends.delete(requestId);
    return { ok: false, error: `Lecture du fichier impossible (${err.message}).` };
  }
  const outcome = await result;
  if (!outcome.ok) return outcome;
  const nameOf = (peerId) => members.find((m) => m.peerId === peerId)?.name ?? 'un ami';
  return {
    ok: true,
    delivered: outcome.delivered.map(nameOf),
    failed: outcome.failed.map(nameOf),
    skipped,
    shownHere,
  };
}

ipcMain.on('net:event', (event, name, payload) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  if (name === 'members' && room) {
    room.members = payload.map((m) => ({
      peerId: String(m.peerId),
      id: m.id,
      name: m.name,
      maxSizeMb: Number(m.maxSizeMb) || 20,
    }));
    notifyRoom();
  } else if (name === 'warnings' && room) {
    room.warnings = payload.slice(0, 5).map(String);
    notifyRoom();
  } else if (name === 'media') {
    receiveMedia(payload);
  } else if (name === 'progress') {
    if (pendingSends.has(payload.requestId)) notify('send:progress', clamp(payload.ratio, 0, 1));
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
