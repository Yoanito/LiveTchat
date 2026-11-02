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
// Renvoie { error } ou { size, kind }.
function checkFile(file, maxSizeMb) {
  if (!file) return { error: 'Choisis un fichier.' };
  const kind = mediaKind(file);
  if (!kind) return { error: 'Format non pris en charge (PNG, JPEG, WebP, GIF, MP4, WebM).' };
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { error: 'Fichier introuvable.' };
  }
  if (maxSizeMb && size > maxSizeMb * 1024 * 1024) return { error: `Fichier trop lourd (max ${maxSizeMb} Mo).` };
  return { size, kind };
}

module.exports = { mediaKind, checkFile };
