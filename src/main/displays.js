// Écrans et zone d'affichage.
const { screen } = require('electron');

function targetDisplay(displayId) {
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
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

// Zone en pixels (DIP) à partir des fractions enregistrées.
function zoneBounds(displayId, zone) {
  const { bounds } = targetDisplay(displayId);
  return {
    x: Math.round(bounds.x + zone.x * bounds.width),
    y: Math.round(bounds.y + zone.y * bounds.height),
    width: Math.max(1, Math.round(zone.width * bounds.width)),
    height: Math.max(1, Math.round(zone.height * bounds.height)),
  };
}

// Sous Windows, une fenêtre déplacée vers un écran d'une autre mise à l'échelle
// (100 % → 150 %) peut garder la taille calculée pour l'ancien écran.
// On vérifie et on applique une seconde fois si besoin.
function placeWindow(win, bounds) {
  win.setBounds(bounds);
  const b = win.getBounds();
  if (b.x !== bounds.x || b.y !== bounds.y || b.width !== bounds.width || b.height !== bounds.height) {
    win.setBounds(bounds);
  }
}

module.exports = { targetDisplay, listDisplays, zoneBounds, placeWindow };
