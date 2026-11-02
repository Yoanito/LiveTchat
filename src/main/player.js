// Fenêtre overlay et file d'attente des médias à afficher.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { MAX_TEXT_LENGTH } = require('../protocol');
const { clamp } = require('./util');
const { mediaKind } = require('./files');
const { zoneBounds } = require('./displays');

const MAX_VIDEO_MS = 30_000;

let win = null;
let getSettings = null;
let onQueueChanged = () => {};

const queue = [];
let playing = false;

function createWindow() {
  const s = getSettings();
  win = new BrowserWindow({
    ...zoneBounds(s.displayId, s.zone),
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
      preload: path.join(__dirname, '..', 'preload-overlay.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Les clics traversent la fenêtre vers ce qui est en dessous.
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, '..', 'overlay.html'));
}

function pump() {
  if (playing || queue.length === 0 || !win || win.isDestroyed()) return;
  const item = queue.shift();
  const s = getSettings();
  playing = true;
  win.setBounds(zoneBounds(s.displayId, s.zone));
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.send('overlay:media', {
    ...item,
    sound: s.sound,
    volume: s.volume,
    opacity: s.opacity,
  });
  onQueueChanged(queue.length);
}

// Ajoute un média à la file. Renvoie sa position (0 s'il s'affiche tout de suite).
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

// Certains jeux ou outils (Xbox Game Bar…) repassent au premier plan :
// on réaffirme régulièrement le « toujours au-dessus » pendant l'affichage.
setInterval(() => {
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.setAlwaysOnTop(true, 'screen-saver');
  }
}, 1000);

ipcMain.on('overlay:done', (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  win.hide();
  playing = false;
  onQueueChanged(queue.length);
  pump();
});

function init(deps) {
  getSettings = deps.getSettings;
  onQueueChanged = deps.onQueueChanged;
  createWindow();
}

module.exports = { init, enqueue };
