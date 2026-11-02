const stage = document.getElementById('stage');
const caption = document.getElementById('caption');

// Chaque média reçoit un jeton : un événement en retard d'un ancien média est ignoré.
let token = 0;
let mediaId = null; // identifiant donné par le processus principal, renvoyé à la fin
let timer = null;
let el = null;

// Coupe le média affiché et libère tout de suite le décodeur et le fichier,
// sans attendre le ramasse-miettes (sous Windows, un fichier ouvert ne s'efface pas).
function clear() {
  token += 1;
  clearTimeout(timer);
  timer = null;
  if (el instanceof HTMLVideoElement) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  } else if (el) {
    el.removeAttribute('src');
  }
  el = null;
  stage.replaceChildren();
  caption.textContent = '';
  caption.hidden = true;
}

function finish(t) {
  if (t !== token) return;
  const id = mediaId;
  clear();
  window.overlay.done(id);
}

// Le média n'est ajouté à la page qu'après lecture de ses dimensions :
// une image n'est décodée (et ne prend de la RAM) qu'une fois dans la page.
function show(t, media) {
  stage.replaceChildren(el);
  // Toujours en texte brut : jamais interprété comme du HTML.
  caption.textContent = media.text;
  caption.hidden = !media.text;
  timer = setTimeout(() => finish(t), media.kind === 'image' ? media.durationMs : media.maxVideoMs);
}

window.overlay.onMedia((media) => {
  clear();
  const t = token;
  mediaId = media.id;
  document.body.style.opacity = media.opacity;

  if (media.kind === 'image') {
    const img = new Image();
    el = img;
    img.addEventListener('load', () => {
      if (t !== token) return;
      if (img.naturalWidth * img.naturalHeight > media.maxImagePixels) return finish(t);
      show(t, media);
    });
    img.addEventListener('error', () => finish(t));
    img.src = media.url;
    return;
  }

  const video = document.createElement('video');
  el = video;
  video.playsInline = true;
  video.muted = !media.sound;
  video.volume = media.volume;
  video.addEventListener('ended', () => finish(t));
  video.addEventListener('error', () => finish(t));
  video.addEventListener('loadedmetadata', () => {
    if (t !== token) return;
    if (video.videoWidth * video.videoHeight > media.maxVideoPixels) return finish(t);
    show(t, media);
    // Si la lecture avec son est refusée, on retente sans son.
    video.play().catch(() => {
      if (t !== token) return;
      video.muted = true;
      video.play().catch(() => finish(t));
    });
  });
  video.src = media.url;
});

window.overlay.onStop(clear);
