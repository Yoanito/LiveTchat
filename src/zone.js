const rectEl = document.getElementById('rect');
const dimsEl = document.getElementById('dims');
const MIN = 40;

// Zone courante en pixels de la fenêtre (qui couvre tout l'écran).
let rect = { x: 0, y: 0, width: 0, height: 0 };
let drag = null;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function render() {
  rectEl.style.left = `${rect.x}px`;
  rectEl.style.top = `${rect.y}px`;
  rectEl.style.width = `${rect.width}px`;
  rectEl.style.height = `${rect.height}px`;
  dimsEl.textContent = `${Math.round(rect.width * devicePixelRatio)} × ${Math.round(rect.height * devicePixelRatio)}`;
}

function startDrag(mode, e) {
  e.preventDefault();
  e.stopPropagation();
  drag = { mode, startX: e.clientX, startY: e.clientY, origin: { ...rect } };
}

rectEl.addEventListener('pointerdown', (e) => startDrag('move', e));
document.getElementById('handle').addEventListener('pointerdown', (e) => startDrag('resize', e));
document.body.addEventListener('pointerdown', (e) => {
  if (e.target !== document.body) return;
  const previous = { ...rect };
  rect = { x: e.clientX, y: e.clientY, width: 0, height: 0 };
  startDrag('draw', e);
  drag.origin = previous;
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const W = innerWidth;
  const H = innerHeight;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  const o = drag.origin;
  if (drag.mode === 'move') {
    rect.x = clamp(o.x + dx, 0, W - o.width);
    rect.y = clamp(o.y + dy, 0, H - o.height);
  } else if (drag.mode === 'resize') {
    rect.width = clamp(o.width + dx, MIN, W - o.x);
    rect.height = clamp(o.height + dy, MIN, H - o.y);
  } else {
    const x2 = clamp(e.clientX, 0, W);
    const y2 = clamp(e.clientY, 0, H);
    rect.x = Math.min(drag.startX, x2);
    rect.y = Math.min(drag.startY, y2);
    rect.width = Math.abs(x2 - drag.startX);
    rect.height = Math.abs(y2 - drag.startY);
  }
  render();
});

window.addEventListener('pointerup', () => {
  if (drag?.mode === 'draw' && (rect.width < MIN || rect.height < MIN)) {
    rect = { ...drag.origin };
    render();
  }
  drag = null;
});

function save() {
  window.zone.save({
    x: rect.x / innerWidth,
    y: rect.y / innerHeight,
    width: rect.width / innerWidth,
    height: rect.height / innerHeight,
  });
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('cancel').addEventListener('click', () => window.zone.cancel());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
  if (e.key === 'Escape') window.zone.cancel();
});

window.zone.init().then((z) => {
  rect = {
    x: z.x * innerWidth,
    y: z.y * innerHeight,
    width: z.width * innerWidth,
    height: z.height * innerHeight,
  };
  render();
});
