// Vérification des fichiers médias locaux.
const fs = require('node:fs');
const path = require('node:path');
const { IMAGE_EXT, VIDEO_EXT } = require('../protocol');

function mediaKind(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

// Vérifie un fichier local avant de l'afficher ou de l'envoyer.
function checkFile(file, maxSizeMb) {
  if (!file) return 'Choisis un fichier.';
  if (!mediaKind(file)) return 'Format non pris en charge (PNG, JPEG, WebP, GIF, MP4, WebM).';
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return 'Fichier introuvable.';
  }
  if (maxSizeMb && size > maxSizeMb * 1024 * 1024) return `Fichier trop lourd (max ${maxSizeMb} Mo).`;
  return null;
}

module.exports = { mediaKind, checkFile };
