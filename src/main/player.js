// Fenêtre overlay et file d'attente des médias à afficher.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  MAX_TEXT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_QUEUE,
  MAX_IMAGE_PIXELS,
  MAX_VIDEO_PIXELS,
  MAX_DISPLAY_SECONDS,
  DEFAULT_DISPLAY_SECONDS,
} = require('../protocol');
const { clamp, parseNumber } = require('./util');
const { mediaKind } = require('./files');
const { zoneBounds, placeWindow } = require('./displays');

let win = null;
let getSettings = null;
let onQueueChanged = () => {};

// Si l'overlay ne répond pas à temps (page plantée ou bloquée), on passe au média suivant.
const WATCHDOG_MARGIN_MS = 10_000;
const RELOAD_DELAY_MS = 1000;

// Chaque élément : { id, file, url, kind, text, topText, from, fromId, sendId, mine, durationMs, onDone? }.
// from : pseudo de l'envoyeur, affiché sur le média. fromId et sendId servent à annuler un envoi.
// mine : média que j'ai envoyé (ou testé chez moi), que je peux annuler.
// onDone est appelé quand le média a été affiché ou retiré de la file.
const queue = [];
let current = null;
let nextId = 1;
let watchdog = null;
let keepOnTopTimer = null;
// La page overlay est chargée et peut recevoir un média.
let ready = false;

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
  win.webContents.on('did-finish-load', () => {
    ready = true;
    pump();
  });
  // Page plantée : le média en cours est abandonné, la page est rechargée et la file reprend.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error("L'overlay s'est arrêté :", details.reason);
    ready = false;
    finishCurrent();
    setTimeout(() => alive() && win.webContents.reload(), RELOAD_DELAY_MS);
  });
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
  if (current || !ready || queue.length === 0 || !alive()) return;
  current = queue.shift();
  const s = getSettings();
  placeWindow(win, zoneBounds(s.displayId, s.zone));
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  keepOnTop(true);
  // Pas de réponse à temps : la page est bloquée ou cassée. On l'arrête,
  // elle est rechargée comme après un plantage et la file reprend.
  watchdog = setTimeout(() => {
    console.error("L'overlay ne répond plus, rechargement.");
    ready = false;
    finishCurrent();
    if (alive()) win.webContents.forcefullyCrashRenderer();
  }, current.durationMs + WATCHDOG_MARGIN_MS);
  win.webContents.send('overlay:media', {
    id: current.id,
    url: current.url,
    kind: current.kind,
    text: current.text,
    topText: current.topText,
    from: current.from,
    durationMs: current.durationMs,
    maxImagePixels: MAX_IMAGE_PIXELS,
    maxVideoPixels: MAX_VIDEO_PIXELS,
    sound: s.sound,
    chime: s.chime,
    volume: s.volume,
    opacity: s.opacity,
  });
  onQueueChanged(queue.length);
}

function finishCurrent() {
  if (!current) return;
  const item = current;
  current = null;
  clearTimeout(watchdog);
  watchdog = null;
  keepOnTop(false);
  if (alive()) win.hide();
  item.onDone?.();
  onQueueChanged(queue.length);
  pump();
}

// Ajoute un média à la file. Renvoie sa position (0 s'il s'affiche tout de suite),
// ou null si la file est pleine : le média est alors ignoré.
function enqueue(file, { text, topText, from, fromId = null, sendId = null, mine = false, seconds, onDone }) {
  if (queue.length >= MAX_QUEUE) {
    onDone?.();
    return null;
  }
  const busy = Boolean(current);
  queue.push({
    id: nextId++,
    file,
    url: pathToFileURL(file).href,
    kind: mediaKind(file),
    text: String(text ?? '').slice(0, MAX_TEXT_LENGTH),
    topText: String(topText ?? '').slice(0, MAX_TEXT_LENGTH),
    from: String(from ?? '').slice(0, MAX_NAME_LENGTH),
    fromId,
    sendId,
    mine,
    durationMs: clamp(parseNumber(seconds) ?? DEFAULT_DISPLAY_SECONDS, 1, MAX_DISPLAY_SECONDS) * 1000,
    onDone,
  });
  pump();
  return busy ? queue.length : 0;
}

// Retire de la file (et coupe s'il est affiché) chaque média qui vérifie la condition.
// Renvoie le nombre de médias retirés.
function drop(predicate) {
  let count = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (predicate(queue[i])) {
      queue.splice(i, 1)[0].onDone?.();
      count += 1;
    }
  }
  if (current && predicate(current)) {
    count += 1;
    if (alive()) win.webContents.send('overlay:stop');
    finishCurrent();
  }
  onQueueChanged(queue.length);
  return count;
}

ipcMain.on('overlay:done', (event, id) => {
  if (!alive() || event.sender !== win.webContents) return;
  // Fin en retard d'un média déjà abandonné par le minuteur de secours : ignorée.
  if (current?.id === id) finishCurrent();
});

function init(deps) {
  getSettings = deps.getSettings;
  onQueueChanged = deps.onQueueChanged;
  createWindow();
}

module.exports = { init, enqueue, drop };
