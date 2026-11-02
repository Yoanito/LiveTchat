const stage = document.getElementById('stage');
const caption = document.getElementById('caption');
const captionTop = document.getElementById('captionTop');
const sender = document.getElementById('sender');

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
  for (const p of [caption, captionTop, sender]) {
    p.textContent = '';
    p.hidden = true;
  }
}

// Petit « pop » doux en deux notes, fabriqué sur place : aucun fichier son à charger.
let audio = null;
function chime(volume) {
  if (volume <= 0) return;
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  const start = audio.currentTime + 0.01;
  [880, 1320].forEach((freq, i) => {
    const t = start + i * 0.09;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25 * volume, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}

// Place le pseudo en haut à gauche de l'image telle qu'elle est affichée
// (centrée et réduite pour tenir dans la zone, jamais agrandie).
function placeSender(width, height) {
  const zoneW = window.innerWidth;
  const zoneH = window.innerHeight;
  const scale = Math.min(1, zoneW / width, zoneH / height);
  const shownW = width * scale;
  const shownH = height * scale;
  const margin = 8;
  sender.style.left = `${(zoneW - shownW) / 2 + margin}px`;
  sender.style.top = `${(zoneH - shownH) / 2 + margin}px`;
  sender.style.maxWidth = `${Math.max(40, shownW - 2 * margin)}px`;
}

function finish(t) {
  if (t !== token) return;
  const id = mediaId;
  clear();
  window.overlay.done(id);
}

// Le média n'est ajouté à la page qu'après lecture de ses dimensions :
// une image n'est décodée (et ne prend de la RAM) qu'une fois dans la page.
function show(t, media, width, height) {
  stage.replaceChildren(el);
  // Toujours en texte brut : jamais interprété comme du HTML.
  caption.textContent = media.text;
  caption.hidden = !media.text;
  captionTop.textContent = media.topText;
  captionTop.hidden = !media.topText;
  sender.textContent = media.from;
  sender.hidden = !media.from;
  if (media.from) placeSender(width, height);
  if (media.chime) chime(media.volume);
  // Même durée pour une image et une vidéo : une vidéo plus longue est coupée.
  timer = setTimeout(() => finish(t), media.durationMs);
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
      show(t, media, img.naturalWidth, img.naturalHeight);
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
    show(t, media, video.videoWidth, video.videoHeight);
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
