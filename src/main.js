// Processus principal : fenêtre de réglages, fenêtre overlay et sélecteur de zone.
const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const VIDEO_EXT = ['.mp4', '.webm'];
const MAX_VIDEO_MS = 30_000;
const MAX_TEXT_LENGTH = 200;

const DEFAULTS = {
  displayId: null,
  // Zone en fractions de l'écran (0 à 1), pour rester valable quel que soit le DPI.
  zone: { x: 0, y: 0, width: 1, height: 1 },
  sound: true,
  volume: 0.5,
  opacity: 1,
  maxSizeMb: 20,
};

let settings;
let controlWin = null;
let overlayWin = null;
let zoneWin = null;

const queue = [];
let playing = false;

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
    height: 680,
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
  if ('maxSizeMb' in patch) settings.maxSizeMb = clamp(patch.maxSizeMb, 1, 500);
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
      { name: 'Images et vidéos', extensions: [...IMAGE_EXT, ...VIDEO_EXT].map((e) => e.slice(1)) },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('media:send', (event, { file, text, imageSeconds }) => {
  if (!fromWindow(controlWin)(event)) return { ok: false, error: 'Origine refusée.' };
  if (!file) return { ok: false, error: 'Choisis un fichier.' };
  const kind = mediaKind(file);
  if (!kind) return { ok: false, error: 'Format non pris en charge (PNG, JPEG, WebP, GIF, MP4, WebM).' };
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { ok: false, error: 'Fichier introuvable.' };
  }
  if (size > settings.maxSizeMb * 1024 * 1024) {
    return { ok: false, error: `Fichier trop lourd (max ${settings.maxSizeMb} Mo).` };
  }
  const busy = playing;
  queue.push({
    url: pathToFileURL(file).href,
    kind,
    text: String(text ?? '').slice(0, MAX_TEXT_LENGTH),
    durationMs: clamp(imageSeconds, 1, 30) * 1000,
    maxVideoMs: MAX_VIDEO_MS,
  });
  pump();
  return { ok: true, position: busy ? queue.length : 0 };
});

ipcMain.on('overlay:done', (event) => {
  if (!fromWindow(overlayWin)(event)) return;
  overlayWin.hide();
  playing = false;
  controlWin?.webContents.send('queue:changed', queue.length);
  pump();
});

// ---------- Démarrage ----------

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
