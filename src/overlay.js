const stage = document.getElementById('stage');
const caption = document.getElementById('caption');

let current = 0;
let timer = null;

function finish(token) {
  if (token !== current) return;
  current += 1;
  clearTimeout(timer);
  stage.querySelector('video')?.pause();
  stage.replaceChildren();
  caption.textContent = '';
  caption.hidden = true;
  window.overlay.done();
}

window.overlay.onMedia((media) => {
  current += 1;
  const token = current;
  clearTimeout(timer);
  document.body.style.opacity = media.opacity;

  let el;
  if (media.kind === 'image') {
    el = new Image();
    el.addEventListener('load', () => {
      timer = setTimeout(() => finish(token), media.durationMs);
    });
  } else {
    el = document.createElement('video');
    el.autoplay = true;
    el.playsInline = true;
    el.muted = !media.sound;
    el.volume = media.volume;
    el.addEventListener('ended', () => finish(token));
    el.addEventListener('loadedmetadata', () => {
      timer = setTimeout(() => finish(token), media.maxVideoMs);
      // Si la lecture avec son est refusée, on retente sans son.
      el.play().catch(() => {
        el.muted = true;
        el.play().catch(() => finish(token));
      });
    });
  }
  el.addEventListener('error', () => finish(token));
  el.src = media.url;
  stage.replaceChildren(el);

  // Toujours en texte brut : jamais interprété comme du HTML.
  caption.textContent = media.text;
  caption.hidden = !media.text;
});
