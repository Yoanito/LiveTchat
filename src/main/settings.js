// Réglages enregistrés dans %APPDATA%\livetchat\settings.json.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MAX_FILE_MB, MAX_NAME_LENGTH } = require('../protocol');
const { clamp, sanitizeZone } = require('./util');

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

// Les curseurs envoient des dizaines de changements par seconde : on n'écrit qu'une fois arrêté.
const SAVE_DELAY_MS = 300;

let settings = null;
let saveTimer = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Remet chaque réglage dans les bornes, même si le fichier a été modifié à la main.
function normalize(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const displayId = s.displayId == null ? null : Number(s.displayId);
  return {
    displayId: Number.isFinite(displayId) ? displayId : null,
    zone: sanitizeZone({ ...DEFAULTS.zone, ...s.zone }),
    sound: 'sound' in s ? Boolean(s.sound) : DEFAULTS.sound,
    volume: 'volume' in s ? clamp(s.volume, 0, 1) : DEFAULTS.volume,
    opacity: 'opacity' in s ? clamp(s.opacity, 0.1, 1) : DEFAULTS.opacity,
    maxSizeMb: 'maxSizeMb' in s ? clamp(s.maxSizeMb, 1, MAX_FILE_MB) : DEFAULTS.maxSizeMb,
    name: String(s.name ?? '').slice(0, MAX_NAME_LENGTH),
    clientId: typeof s.clientId === 'string' && s.clientId ? s.clientId : null,
    lastCode: typeof s.lastCode === 'string' ? s.lastCode : '',
    muted: Array.isArray(s.muted) ? s.muted.filter((id) => typeof id === 'string') : [],
  };
}

function load() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    // Premier lancement ou fichier illisible : réglages par défaut.
  }
  settings = normalize(saved);
  return settings;
}

function get() {
  return settings;
}

// Écrit dans un fichier temporaire puis le renomme : un plantage en pleine écriture
// laisse l'ancien fichier intact au lieu d'un fichier à moitié écrit.
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const file = settingsFile();
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Réglages non enregistrés :', err.message);
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

// À la fermeture : écrit tout de suite ce qui attendait.
function flush() {
  if (saveTimer) saveNow();
}

// Mon identifiant sert aux autres pour me mettre en sourdine : il ne doit jamais se perdre.
function ensureClientId() {
  if (!settings.clientId) {
    settings.clientId = crypto.randomUUID();
    saveNow();
  }
}

module.exports = { DEFAULTS, normalize, load, get, save, saveNow, flush, ensureClientId };
