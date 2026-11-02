// Processus principal : démarrage, fenêtre de réglages et messages venant d'elle.
// L'overlay, le sélecteur de zone et le salon sont dans src/main/.
const { app, BrowserWindow, ipcMain, screen, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  MEDIA_EXT,
  MAX_TEXT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_FILE_MB,
  MAX_IMAGE_PIXELS,
  MAX_VIDEO_PIXELS,
  MAX_DISPLAY_SECONDS,
} = require('./protocol');
const { clamp, parseNumber } = require('./main/util');
const { checkFile } = require('./main/files');
const { newRoomCode, normalizeCode } = require('./main/room-code');
const settings = require('./main/settings');
const displays = require('./main/displays');
const player = require('./main/player');
const zonePicker = require('./main/zone-picker');
const room = require('./main/room');

let controlWin = null;
// Fichier choisi dans la fenêtre de réglages. Son chemin reste ici :
// la page ne reçoit que son nom et son adresse pour l'aperçu.
let selectedFile = null;

// Limites que la fenêtre de réglages vérifie avant d'envoyer.
const LIMITS = {
  maxFileMb: MAX_FILE_MB,
  maxImagePixels: MAX_IMAGE_PIXELS,
  maxVideoPixels: MAX_VIDEO_PIXELS,
  maxDisplaySeconds: MAX_DISPLAY_SECONDS,
};

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---------- Fenêtre de réglages ----------

// La fenêtre peut déjà être détruite pendant la fermeture de l'appli.
function sendToControl(channel, payload) {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send(channel, payload);
}

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
  controlWin.on('closed', () => {
    controlWin = null;
    app.quit();
  });
}

function notifyDisplays() {
  sendToControl('displays:changed', displays.listDisplays());
}

// ---------- IPC de la fenêtre de réglages ----------

const fromControl = (event) => controlWin && !controlWin.isDestroyed() && event.sender === controlWin.webContents;

ipcMain.handle('settings:get', (event) => {
  if (!fromControl(event)) return null;
  return { settings: settings.get(), displays: displays.listDisplays(), limits: LIMITS };
});

ipcMain.handle('settings:set', (event, patch) => {
  if (!fromControl(event)) return null;
  const s = settings.get();
  // Un champ vidé garde l'ancienne valeur (la fenêtre la réaffiche).
  const number = (key) => (key in patch ? parseNumber(patch[key]) : null);
  if (number('displayId') !== null) s.displayId = number('displayId');
  if ('sound' in patch) s.sound = Boolean(patch.sound);
  if ('chime' in patch) s.chime = Boolean(patch.chime);
  if (number('volume') !== null) s.volume = clamp(number('volume'), 0, 1);
  if (number('opacity') !== null) s.opacity = clamp(number('opacity'), 0.1, 1);
  if (number('maxSizeMb') !== null) s.maxSizeMb = clamp(number('maxSizeMb'), 1, MAX_FILE_MB);
  if ('name' in patch) s.name = String(patch.name).trim().slice(0, MAX_NAME_LENGTH);
  if (patch.zone === 'full') s.zone = { ...settings.DEFAULTS.zone };
  settings.save();
  if ('maxSizeMb' in patch || 'name' in patch) room.updateProfile();
  return s;
});

ipcMain.handle('zone:edit', (event) => {
  if (!fromControl(event)) return;
  const s = settings.get();
  zonePicker.open({
    bounds: displays.targetDisplay(s.displayId).bounds,
    zone: s.zone,
    onSave: (zone) => {
      s.zone = zone;
      settings.save();
      sendToControl('settings:changed', s);
    },
  });
});

ipcMain.handle('media:pick', async (event) => {
  if (!fromControl(event)) return null;
  // On rouvre le dernier dossier utilisé, s'il existe encore.
  const { lastDir } = settings.get();
  const result = await dialog.showOpenDialog(controlWin, {
    properties: ['openFile'],
    ...(lastDir && fs.existsSync(lastDir) ? { defaultPath: lastDir } : {}),
    filters: [{ name: 'Images et vidéos', extensions: MEDIA_EXT.map((e) => e.slice(1)) }],
  });
  if (result.canceled) return null;
  const file = result.filePaths[0];
  settings.get().lastDir = path.dirname(file);
  settings.save();
  const { error, size, kind } = checkFile(file, MAX_FILE_MB);
  selectedFile = error ? null : file;
  if (error) return { error };
  return { name: path.basename(file), url: pathToFileURL(file).href, kind, size };
});

// Test local : affiche le média uniquement chez moi.
ipcMain.handle('media:send', (event, { text, topText, seconds }) => {
  if (!fromControl(event)) return { ok: false, error: 'Origine refusée.' };
  const { error } = checkFile(selectedFile, settings.get().maxSizeMb);
  if (error) return { ok: false, error };
  const position = player.enqueue(selectedFile, { text, topText, seconds, from: room.myName(), mine: true });
  if (position === null) return { ok: false, error: "File d'attente pleine, réessaie dans un moment." };
  return { ok: true, position };
});

ipcMain.handle('room:create', (event) => {
  if (!fromControl(event)) return { ok: false };
  room.join(newRoomCode());
  return { ok: true };
});

ipcMain.handle('room:join', (event, text) => {
  if (!fromControl(event)) return { ok: false };
  const code = normalizeCode(text);
  if (!code) return { ok: false, error: 'Code invalide. Il ressemble à k7p2-x9qd-4mzt-wb3h.' };
  room.join(code);
  return { ok: true };
});

ipcMain.handle('room:leave', (event) => {
  if (fromControl(event)) room.leave();
});

ipcMain.handle('room:get', (event) => (fromControl(event) ? room.get() : null));

// to : null pour tout le salon, sinon les identifiants des amis choisis.
ipcMain.handle('room:send', (event, { text, topText, seconds, to }) => {
  if (!fromControl(event)) return { ok: false, error: 'Origine refusée.' };
  const { error, size } = checkFile(selectedFile, MAX_FILE_MB);
  if (error) return { ok: false, error };
  const recipients = Array.isArray(to) ? to.filter((id) => typeof id === 'string').slice(0, 100) : null;
  if (recipients && recipients.length === 0) return { ok: false, error: 'Choisis au moins une personne.' };
  return room.send(selectedFile, size, {
    text: String(text ?? '').slice(0, MAX_TEXT_LENGTH),
    topText: String(topText ?? '').slice(0, MAX_TEXT_LENGTH),
    seconds,
    to: recipients,
  });
});

// Retire tout de suite mes médias, chez moi et chez les amis, quel que soit le temps restant.
ipcMain.handle('media:cancel', (event) => (fromControl(event) ? room.cancelMine() : null));

ipcMain.handle('room:mute', (event, { id, muted }) => {
  if (!fromControl(event)) return null;
  const s = settings.get();
  const set = new Set(s.muted);
  if (muted) set.add(String(id));
  else set.delete(String(id));
  s.muted = [...set];
  settings.save();
  room.updateProfile();
  return s.muted;
});

ipcMain.handle('clipboard:write', (event, text) => {
  if (fromControl(event)) clipboard.writeText(String(text));
});

// ---------- Démarrage ----------

// LIVETCHAT_PROFILE permet de lancer plusieurs instances sur le même PC pour tester.
const profile = String(process.env.LIVETCHAT_PROFILE ?? '').replace(/\W/g, '');
if (profile) app.setPath('userData', `${app.getPath('userData')}-${profile}`);

app.on('before-quit', () => room.leave({ sync: true }));
app.on('will-quit', () => settings.flush());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Appli relancée alors qu'elle tourne déjà : on montre la fenêtre, même réduite.
  app.on('second-instance', () => {
    if (!controlWin) return;
    if (controlWin.isMinimized()) controlWin.restore();
    controlWin.show();
    controlWin.focus();
  });

  app.whenReady().then(() => {
    settings.load();
    player.init({
      getSettings: settings.get,
      onQueueChanged: (n) => sendToControl('queue:changed', n),
    });
    room.init({
      notify: sendToControl,
      player,
      // Un dossier par profil : deux instances de test ne s'effacent pas leurs fichiers.
      tempRoot: path.join(app.getPath('temp'), profile ? `livetchat-${profile}` : 'livetchat'),
    });
    createControl();
    screen.on('display-added', notifyDisplays);
    screen.on('display-removed', notifyDisplays);
    screen.on('display-metrics-changed', notifyDisplays);
  });
}
