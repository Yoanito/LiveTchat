// Petites fonctions sans dépendance à Electron.

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

// Nombre tapé dans un champ. null si le champ est vide ou invalide : on garde alors
// la valeur précédente au lieu de la ramener au minimum.
function parseNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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

module.exports = { clamp, parseNumber, sanitizeZone };
