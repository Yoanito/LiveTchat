// Fenêtre overlay et file d'attente des médias à afficher.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  MAX_TEXT_LENGTH,
  MAX_QUEUE,
  MAX_IMAGE_PIXELS,
  MAX_VIDEO_PIXELS,
  MAX_VIDEO_SECONDS,
} = require('../protocol');
const { clamp } = require('./util');
const { mediaKind } = require('./files');
const { zoneBounds } = require('./displays');

let win = null;
let getSettings = null;
let onQueueChanged = () => {};

// Chaque élément : { file, url, kind, text, durationMs, onDone? }.
// onDone est appelé quand le média a été affiché ou retiré de la file.
const queue = [];
let current = null;
let keepOnTopTimer = null;

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

const alive = () => win && !win.isDestroyed();

// Certains jeux ou outils (Xbox Game Bar…) repassent au premier plan :
// on réaffirme le « toujours au-dessus » chaque seconde, seulement pendant l'affichage.
function keepOnTop(active) {
  clearInterval(keepOnTopTimer);
  keepOnTopTimer = active
    ? setInterval(() => alive() && win.setAlwaysOnTop(true, 'screen-saver'), 1000)
    : null;
}

function pump() {
  if (current || queue.length === 0 || !alive()) return;
  current = queue.shift();
  const s = getSettings();
  win.setBounds(zoneBounds(s.displayId, s.zone));
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  keepOnTop(true);
  win.webContents.send('overlay:media', {
    url: current.url,
    kind: current.kind,
    text: current.text,
    durationMs: current.durationMs,
    maxVideoMs: MAX_VIDEO_SECONDS * 1000,
    maxImagePixels: MAX_IMAGE_PIXELS,
    maxVideoPixels: MAX_VIDEO_PIXELS,
    sound: s.sound,
    volume: s.volume,
    opacity: s.opacity,
  });
  onQueueChanged(queue.length);
}

function finishCurrent() {
  if (!current) return;
  const item = current;
  current = null;
  keepOnTop(false);
  if (alive()) win.hide();
  item.onDone?.();
  onQueueChanged(queue.length);
  pump();
}

// Ajoute un média à la file. Renvoie sa position (0 s'il s'affiche tout de suite),
// ou null si la file est pleine : le média est alors ignoré.
function enqueue(file, { text, imageSeconds, onDone }) {
  if (queue.length >= MAX_QUEUE) {
    onDone?.();
    return null;
  }
  const busy = Boolean(current);
  queue.push({
    file,
    url: pathToFileURL(file).href,
    kind: mediaKind(file),
    text: String(text ?? '').slice(0, MAX_TEXT_LENGTH),
    durationMs: clamp(imageSeconds, 1, 30) * 1000,
    onDone,
  });
  pump();
  return busy ? queue.length : 0;
}

// Retire de la file (et coupe s'il est affiché) chaque média qui vérifie la condition.
function drop(predicate) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (predicate(queue[i])) queue.splice(i, 1)[0].onDone?.();
  }
  if (current && predicate(current)) {
    if (alive()) win.webContents.send('overlay:stop');
    finishCurrent();
  }
  onQueueChanged(queue.length);
}

ipcMain.on('overlay:done', (event) => {
  if (!alive() || event.sender !== win.webContents) return;
  finishCurrent();
});

function init(deps) {
  getSettings = deps.getSettings;
  onQueueChanged = deps.onQueueChanged;
  createWindow();
}

module.exports = { init, enqueue, drop };
