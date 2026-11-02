// Constantes partagées par le processus principal (et transmises aux pages qui en ont besoin).
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const VIDEO_EXT = ['.mp4', '.webm'];

module.exports = {
  IMAGE_EXT,
  VIDEO_EXT,
  MEDIA_EXT: [...IMAGE_EXT, ...VIDEO_EXT],
  MAX_TEXT_LENGTH: 200,
  MAX_NAME_LENGTH: 32,
  // Taille max d'un média envoyé ou reçu. Chaque ami peut accepter moins.
  // Un fichier passe en entier en mémoire : au-delà, l'appli prendrait des Go de RAM.
  MAX_FILE_MB: 100,
  // Une image décodée prend largeur × hauteur × 4 octets : 40 mégapixels ≈ 160 Mo.
  // Un petit PNG peut cacher des dimensions énormes, la taille du fichier ne suffit pas.
  MAX_IMAGE_PIXELS: 40_000_000,
  // Au-delà de la 4K, une vidéo charge trop la carte graphique pendant un jeu.
  MAX_VIDEO_PIXELS: 3840 * 2160,
  MAX_VIDEO_SECONDS: 30,
  // Durée d'affichage d'une image quand le champ est vide.
  DEFAULT_IMAGE_SECONDS: 5,
  // Médias en attente d'affichage, au-delà les nouveaux sont ignorés.
  MAX_QUEUE: 10,
};
