// Réglages enregistrés dans %APPDATA%\livetchat\settings.json.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

let settings = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...DEFAULTS, ...saved, zone: { ...DEFAULTS.zone, ...saved.zone } };
  } catch {
    settings = structuredClone(DEFAULTS);
  }
  return settings;
}

function get() {
  return settings;
}

function save() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

function ensureClientId() {
  if (!settings.clientId) {
    settings.clientId = crypto.randomUUID();
    save();
  }
}

module.exports = { DEFAULTS, load, get, save, ensureClientId };
