// Processus principal : fenêtre de réglages, fenêtre overlay et sélecteur de zone.
const { app, BrowserWindow, ipcMain, screen, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const {
  IMAGE_EXT,
  VIDEO_EXT,
  MEDIA_EXT,
  MAX_TEXT_LENGTH,
  MAX_NAME_LENGTH,
  DEFAULT_PORT,
} = require('./room/protocol');
const { RoomServer } = require('./room/server');
const { RoomClient } = require('./room/client');
const { formatAddress, parseAddress } = require('./room/address');
const upnp = require('./room/upnp');

const MAX_VIDEO_MS = 30_000;

const DEFAULTS = {
  displayId: null,
  // Zone en fractions de l'écran (0 à 1), pour rester valable quel que soit le DPI.
  zone: { x: 0, y: 0, width: 1, height: 1 },
  sound: true,
  volume: 0.5,
  opacity: 1,
  // Taille max des médias dans le salon que j'héberge.
  maxSizeMb: 20,
  name: '',
  clientId: null,
  port: DEFAULT_PORT,
  upnp: true,
  lastAddress: '',
  muted: [],
};

let settings;
let controlWin = null;
let overlayWin = null;
let zoneWin = null;

const queue = [];
let playing = false;

// Salon courant : serveur si j'héberge, client dans tous les cas.
let server = null;
let client = null;
let room = null;

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
    if (server) {
      server.setMaxSize(settings.maxSizeMb);
      room.maxSizeMb = settings.maxSizeMb;
    }
  }
  if ('name' in patch) settings.name = String(patch.name).trim().slice(0, MAX_NAME_LENGTH);
  if ('upnp' in patch) settings.upnp = Boolean(patch.upnp);
  if ('port' in patch) settings.port = Math.round(clamp(patch.port, 1024, 65535));
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

function notifyRoom() {
  controlWin?.webContents.send('room:changed', room);
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal && /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(net.address)) {
        return net.address;
      }
    }
  }
  return null;
}

// Adresse privée ou partagée par le FAI (CGNAT) : injoignable depuis Internet.
function isUnreachableIp(ip) {
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);
}

async function publicIpWithoutUpnp() {
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(4000) });
    const ip = (await res.text()).trim();
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
  } catch {
    return null;
  }
}

function joinTarget(target) {
  ensureClientId();
  client = new RoomClient(target, {
    id: settings.clientId,
    name: settings.name || os.userInfo().username,
  });
  const current = client;
  client.on('status', ({ state, error }) => {
    if (client !== current) return;
    room.state = state;
    room.error = error ?? null;
    if (state === 'disconnected' && room.role === 'member') {
      client = null;
      room = { ...room, members: [] };
    }
    notifyRoom();
  });
  client.on('members', (members) => {
    if (client !== current) return;
    room.members = members.map((m) => ({ ...m, me: m.id === settings.clientId }));
    notifyRoom();
  });
  client.on('room', ({ maxSizeMb }) => {
    if (client !== current) return;
    room.maxSizeMb = maxSizeMb;
    notifyRoom();
  });
  client.on('media', (media) => {
    if (client !== current || settings.muted.includes(media.from?.id)) return;
    if (!mediaKind(media.file)) return;
    enqueue(media.file, media);
  });
  client.connect();
}

async function leaveRoom() {
  client?.leave();
  client = null;
  const hosted = server;
  server = null;
  room = null;
  notifyRoom();
  if (hosted) {
    await hosted.stop().catch(() => {});
    await upnp.closePort();
  }
}

async function hostRoom() {
  await leaveRoom();
  const hosted = new RoomServer();
  hosted.maxSizeMb = settings.maxSizeMb;
  let port;
  try {
    port = await hosted.listen(settings.port);
  } catch (err) {
    await hosted.stop().catch(() => {});
    return {
      ok: false,
      error:
        err.code === 'EADDRINUSE'
          ? `Le port ${settings.port} est déjà utilisé sur ce PC. Choisis-en un autre.`
          : `Impossible de démarrer le salon (${err.code ?? err.message}).`,
    };
  }
  server = hosted;
  const lan = lanAddress();
  room = {
    role: 'host',
    state: 'connecting',
    error: null,
    members: [],
    maxSizeMb: settings.maxSizeMb,
    port,
    lanAddress: lan ? formatAddress(lan, port, hosted.key) : null,
    publicAddress: null,
    internet: 'pending',
  };
  joinTarget({ host: '127.0.0.1', port, key: hosted.key });
  notifyRoom();

  // Ouverture du port sur la box, en arrière-plan.
  let mapping = null;
  if (settings.upnp) {
    try {
      mapping = await upnp.openPort(port);
    } catch {
      mapping = null;
    }
  }
  if (server !== hosted) return { ok: true };
  if (mapping) {
    room.publicAddress = formatAddress(mapping.externalIp, mapping.externalPort, hosted.key);
    room.internet = isUnreachableIp(mapping.externalIp) ? 'cgnat' : 'upnp';
  } else {
    const ip = await publicIpWithoutUpnp();
    if (server !== hosted) return { ok: true };
    room.publicAddress = ip ? formatAddress(ip, port, hosted.key) : null;
    room.internet = settings.upnp ? 'manual' : 'off';
  }
  notifyRoom();
  return { ok: true };
}

ipcMain.handle('room:host', async (event) => {
  if (!fromWindow(controlWin)(event)) return { ok: false };
  const result = await hostRoom();
  if (!result.ok) notifyRoom();
  return result;
});

ipcMain.handle('room:join', async (event, address) => {
  if (!fromWindow(controlWin)(event)) return { ok: false };
  const target = parseAddress(address);
  if (!target) return { ok: false, error: 'Adresse invalide. Elle ressemble à lt://1.2.3.4:41234/… ' };
  await leaveRoom();
  settings.lastAddress = String(address).trim();
  saveSettings();
  room = { role: 'member', state: 'connecting', error: null, members: [], maxSizeMb: null };
  joinTarget(target);
  notifyRoom();
  return { ok: true };
});

ipcMain.handle('room:leave', async (event) => {
  if (fromWindow(controlWin)(event)) await leaveRoom();
});

ipcMain.handle('room:get', (event) => (fromWindow(controlWin)(event) ? room : null));

ipcMain.handle('room:send', async (event, { file, text, imageSeconds }) => {
  if (!fromWindow(controlWin)(event)) return { ok: false, error: 'Origine refusée.' };
  if (!client || room?.state !== 'connected') return { ok: false, error: "Tu n'es pas connecté à un salon." };
  const error = checkFile(file, room.maxSizeMb);
  if (error) return { ok: false, error };
  return client.upload(file, { text, imageSeconds: clamp(imageSeconds, 1, 30) });
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

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting || (!server && !client)) return;
  event.preventDefault();
  quitting = true;
  // Ferme le salon et le port de la box avant de quitter, sans attendre plus de 3 s.
  Promise.race([leaveRoom(), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.quit());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => controlWin?.focus());

  app.whenReady().then(() => {
    settings = loadSettings();
    createOverlay();
    createControl();
    screen.on('display-added', notifyDisplays);
    screen.on('display-removed', notifyDisplays);
    screen.on('display-metrics-changed', notifyDisplays);
  });
}
