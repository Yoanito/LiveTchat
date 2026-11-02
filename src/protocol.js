// Constantes partagées par le processus principal.
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const VIDEO_EXT = ['.mp4', '.webm'];

module.exports = {
  IMAGE_EXT,
  VIDEO_EXT,
  MEDIA_EXT: [...IMAGE_EXT, ...VIDEO_EXT],
  MAX_TEXT_LENGTH: 200,
  MAX_NAME_LENGTH: 32,
};
