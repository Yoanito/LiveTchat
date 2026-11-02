// Processus principal : fenêtre de réglages, fenêtre overlay et sélecteur de zone.
const { app, BrowserWindow, ipcMain, screen, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { IMAGE_EXT, VIDEO_EXT, MEDIA_EXT, MAX_TEXT_LENGTH, MAX_NAME_LENGTH } = require('./protocol');

const MAX_VIDEO_MS = 30_000;

const DEFAULTS = {
  displayId: null,
  // Zone en fractions de l'écran (0 à 1), pour rester valable quel que soit le DPI.
  zone: { x: 0, y: 0, width: 1, height: 1 },
  sound: true,
  volume: 0.5,
  opacity: 1,
  // Taille max des médias que j'accepte de recevoir.
  maxSizeMb: 20,
  name: '',
  clientId: null,
  lastCode: '',
  muted: [],
};

let settings;
let controlWin = null;
let overlayWin = null;
let zoneWin = null;
let netWin = null;

const queue = [];
let playing = false;

// Salon courant (null si je ne suis dans aucun salon).
let room = null;
const pendingSends = new Map();
let recvDir = null;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---------- Réglages ----------

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return { ...DEFAULTS, ...saved, zone: { ...DEFAULTS.zone, ...saved.zone } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function ensureClientId() {
  if (!settings.clientId) {
    settings.clientId = crypto.randomUUID();
    saveSettings();
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

function sanitizeZone(z) {
  const x = clamp(z.x, 0, 1);
  const y = clamp(z.y, 0, 1);
  return {
    x,
    y,
    width: clamp(z.width, 0.02, 1 - x),
    height: clamp(z.height, 0.02, 1 - y),
  };
}

// ---------- Écrans ----------

function targetDisplay() {
  return (
    screen.getAllDisplays().find((d) => d.id === settings.displayId) ||
    screen.getPrimaryDisplay()
  );
}

function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `${d.label || `Écran ${i + 1}`} (${d.size.width}×${d.size.height})${
      d.id === primaryId ? ' – principal' : ''
    }`,
  }));
}

function zoneBounds() {
  const { bounds } = targetDisplay();
  const z = settings.zone;
  return {
    x: Math.round(bounds.x + z.x * bounds.width),
    y: Math.round(bounds.y + z.y * bounds.height),
    width: Math.max(1, Math.round(z.width * bounds.width)),
    height: Math.max(1, Math.round(z.height * bounds.height)),
  };
}

function notifyDisplays() {
  controlWin?.webContents.send('displays:changed', listDisplays());
}

// ---------- Overlay ----------

function createOverlay() {
  overlayWin = new BrowserWindow({
    ...zoneBounds(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Ne prend jamais le focus, n'apparaît ni dans la barre des tâches ni dans Alt+Tab.
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  // Les clics traversent la fenêtre vers ce qui est en dessous.
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.loadFile(path.join(__dirname, 'overlay.html'));
}

function pump() {
  if (playing || queue.length === 0) return;
  const item = queue.shift();
  playing = true;
  overlayWin.setBounds(zoneBounds());
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.showInactive();
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.webContents.send('overlay:media', {
    ...item,
    sound: settings.sound,
    volume: settings.volume,
    opacity: settings.opacity,
  });
  controlWin?.webContents.send('queue:changed', queue.length);
}

function mediaKind(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

// Certains jeux ou outils (Xbox Game Bar…) repassent au premier plan :
// on réaffirme régulièrement le « toujours au-dessus » pendant l'affichage.
setInterval(() => {
  if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) {
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
  }
}, 1000);

// ---------- Sélecteur de zone ----------

function openZonePicker() {
  if (zoneWin) return zoneWin.focus();
  zoneWin = new BrowserWindow({
    ...targetDisplay().bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-zone.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  zoneWin.setAlwaysOnTop(true, 'screen-saver');
  zoneWin.loadFile(path.join(__dirname, 'zone.html'));
  zoneWin.on('closed', () => {
    zoneWin = null;
  });
}

// ---------- Fenêtre de réglages ----------

function createControl() {
  controlWin = new BrowserWindow({
    width: 460,
    height: 860,
    title: 'LiveTchat',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-control.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  controlWin.loadFile(path.join(__dirname, 'control.html'));
  controlWin.on('closed', () => app.quit());
}

// ---------- IPC ----------

function fromWindow(win) {
  return (event) => win && !win.isDestroyed() && event.sender === win.webContents;
}

ipcMain.handle('settings:get', (event) => {
  if (!fromWindow(controlWin)(event)) return null;
  return { settings, displays: listDisplays() };
});

ipcMain.handle('settings:set', (event, patch) => {
  if (!fromWindow(controlWin)(event)) return null;
  if ('displayId' in patch) settings.displayId = Number(patch.displayId);
  if ('sound' in patch) settings.sound = Boolean(patch.sound);
  if ('volume' in patch) settings.volume = clamp(patch.volume, 0, 1);
  if ('opacity' in patch) settings.opacity = clamp(patch.opacity, 0.1, 1);
  if ('maxSizeMb' in patch) {
    settings.maxSizeMb = clamp(patch.maxSizeMb, 1, 500);
    netCommand({ type: 'limit', maxSizeMb: settings.maxSizeMb });
  }
  if ('name' in patch) settings.name = String(patch.name).trim().slice(0, MAX_NAME_LENGTH);
  if (patch.zone === 'full') settings.zone = { ...DEFAULTS.zone };
  saveSettings();
  return settings;
});

ipcMain.handle('zone:edit', (event) => {
  if (fromWindow(controlWin)(event)) openZonePicker();
});

ipcMain.handle('zone:init', (event) => {
  if (fromWindow(zoneWin)(event)) return settings.zone;
  return null;
});

ipcMain.handle('zone:save', (event, zone) => {
  if (!fromWindow(zoneWin)(event)) return;
  settings.zone = sanitizeZone(zone);
  saveSettings();
  controlWin?.webContents.send('settings:changed', settings);
  zoneWin.close();
});

ipcMain.handle('zone:cancel', (event) => {
  if (fromWindow(zoneWin)(event)) zoneWin.close();
});

ipcMain.handle('media:pick', async (event) => {
  if (!fromWindow(controlWin)(event)) return null;
  const result = await dialog.showOpenDialog(controlWin, {
    properties: ['openFile'],
    filters: [
      { name: 'Images et vidéos', extensions: MEDIA_EXT.map((e) => e.slice(1)) },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Vérifie un fichier local avant de l'afficher ou de l'envoyer.
function checkFile(file, maxSizeMb) {
  if (!file) return 'Choisis un fichier.';
  if (!mediaKind(file)) return 'Format non pris en charge (PNG, JPEG, WebP, GIF, MP4, WebM).';
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return 'Fichier introuvable.';
  }
  if (maxSizeMb && size > maxSizeMb * 1024 * 1024) return `Fichier trop lourd (max ${maxSizeMb} Mo).`;
  return null;
}

function enqueue(file, { text, imageSeconds }) {
  const busy = playing;
  queue.push({
    url: pathToFileURL(file).href,
    kind: mediaKind(file),
    text: String(text ?? '').slice(0, MAX_TEXT_LENGTH),
    durationMs: clamp(imageSeconds, 1, 30) * 1000,
    maxVideoMs: MAX_VIDEO_MS,
  });
  pump();
  return busy ? queue.length : 0;
}

// Test local : affiche le média uniquement chez moi.
ipcMain.handle('media:send', (event, { file, text, imageSeconds }) => {
  if (!fromWindow(controlWin)(event)) return { ok: false, error: 'Origine refusée.' };
  const error = checkFile(file, settings.maxSizeMb);
  if (error) return { ok: false, error };
  return { ok: true, position: enqueue(file, { text, imageSeconds }) };
});

// ---------- Salon ----------

// Fenêtre invisible qui porte la connexion directe (WebRTC) avec les autres membres.
function createNetWindow() {
  netWin = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-net.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  netWin.loadFile(path.join(__dirname, 'net', 'net.html'));
}

function netCommand(cmd) {
  if (netWin && !netWin.isDestroyed()) netWin.webContents.send('net:command', cmd);
}

function notifyRoom() {
  controlWin?.webContents.send('room:changed', room);
}

function myName() {
  return settings.name || os.userInfo().username;
}

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

function joinRoom(code) {
  ensureClientId();
  leaveRoom();
  recvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'livetchat-recv-'));
  settings.lastCode = code;
  saveSettings();
  room = { code, members: [], warning: null };
  netCommand({
    type: 'join',
    code,
    id: settings.clientId,
    name: myName(),
    maxSizeMb: settings.maxSizeMb,
    // Pour les tests : relais Nostr personnalisés, séparés par des virgules.
    relayUrls: process.env.LIVETCHAT_RELAYS?.split(',').filter(Boolean),
  });
  notifyRoom();
}

function leaveRoom() {
  if (!room) return;
  netCommand({ type: 'leave' });
  room = null;
  for (const { resolve } of pendingSends.values()) resolve({ ok: false, error: 'Salon quitté.' });
  pendingSends.clear();
  const dir = recvDir;
  recvDir = null;
  if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
  notifyRoom();
}

function receiveMedia({ bytes, ext, text, imageSeconds, from }) {
  if (!room || !recvDir || !(bytes instanceof Uint8Array)) return;
  if (settings.muted.includes(from?.id)) return;
  const safeExt = String(ext ?? '').toLowerCase();
  if (!MEDIA_EXT.includes(safeExt)) return;
  if (bytes.byteLength > settings.maxSizeMb * 1024 * 1024) return;
  const file = path.join(recvDir, crypto.randomUUID() + safeExt);
  fs.writeFile(file, bytes, (err) => {
    if (err) return;
    enqueue(file, { text, imageSeconds });
    // Effacé au bout de 10 minutes, largement après l'affichage.
    setTimeout(() => fs.rm(file, { force: true }, () => {}), 10 * 60_000).unref();
  });
}

ipcMain.on('net:event', (event, name, payload) => {
  if (!fromWindow(netWin)(event)) return;
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

ipcMain.handle('room:create', (event) => {
  if (!fromWindow(controlWin)(event)) return { ok: false };
  joinRoom(newRoomCode());
  return { ok: true };
});

ipcMain.handle('room:join', (event, text) => {
  if (!fromWindow(controlWin)(event)) return { ok: false };
  const code = normalizeCode(text);
  if (!code) return { ok: false, error: 'Code invalide. Il ressemble à k7p2-x9qd-4mzt-wb3h.' };
  joinRoom(code);
  return { ok: true };
});

ipcMain.handle('room:leave', (event) => {
  if (fromWindow(controlWin)(event)) leaveRoom();
});

ipcMain.handle('room:get', (event) => (fromWindow(controlWin)(event) ? room : null));

ipcMain.handle('room:send', async (event, { file, text, imageSeconds }) => {
  if (!fromWindow(controlWin)(event)) return { ok: false, error: 'Origine refusée.' };
  if (!room) return { ok: false, error: "Tu n'es pas dans un salon." };
  const error = checkFile(file, 500);
  if (error) return { ok: false, error };
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
  netCommand({
    type: 'send',
    requestId,
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    ext: path.extname(file).toLowerCase(),
    ...payload,
  });
  return result;
});

ipcMain.handle('room:mute', (event, { id, muted }) => {
  if (!fromWindow(controlWin)(event)) return null;
  const set = new Set(settings.muted);
  if (muted) set.add(String(id));
  else set.delete(String(id));
  settings.muted = [...set];
  saveSettings();
  return settings.muted;
});

ipcMain.handle('clipboard:write', (event, text) => {
  if (fromWindow(controlWin)(event)) clipboard.writeText(String(text));
});

ipcMain.on('overlay:done', (event) => {
  if (!fromWindow(overlayWin)(event)) return;
  overlayWin.hide();
  playing = false;
  controlWin?.webContents.send('queue:changed', queue.length);
  pump();
});

// ---------- Démarrage ----------

// LIVETCHAT_PROFILE permet de lancer plusieurs instances sur le même PC pour tester.
if (process.env.LIVETCHAT_PROFILE) {
  app.setPath('userData', `${app.getPath('userData')}-${process.env.LIVETCHAT_PROFILE.replace(/\W/g, '')}`);
}

app.on('before-quit', () => leaveRoom());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => controlWin?.focus());

  app.whenReady().then(() => {
    settings = loadSettings();
    createOverlay();
    createNetWindow();
    createControl();
    screen.on('display-added', notifyDisplays);
    screen.on('display-removed', notifyDisplays);
    screen.on('display-metrics-changed', notifyDisplays);
  });
}
