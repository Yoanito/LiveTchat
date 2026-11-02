// Petites fonctions sans dépendance à Electron.

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

module.exports = { clamp, sanitizeZone };
