// Sélecteur de zone : calque plein écran pour dessiner la zone à la souris.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { sanitizeZone } = require('./util');
const { placeWindow } = require('./displays');

let win = null;
let current = null; // { zone, onSave }

const fromPicker = (event) => win && !win.isDestroyed() && event.sender === win.webContents;

function open({ bounds, zone, onSave }) {
  if (win) return win.focus();
  current = { zone, onSave };
  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-zone.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  placeWindow(win, bounds);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '..', 'zone.html'));
  win.on('closed', () => {
    win = null;
    current = null;
  });
}

ipcMain.handle('zone:init', (event) => (fromPicker(event) ? current.zone : null));

ipcMain.handle('zone:save', (event, zone) => {
  if (!fromPicker(event)) return;
  current.onSave(sanitizeZone(zone));
  win.close();
});

ipcMain.handle('zone:cancel', (event) => {
  if (fromPicker(event)) win.close();
});

module.exports = { open };
