const $ = (id) => document.getElementById(id);
const api = window.livetchat;

let selectedFile = null;

function fillDisplays(displays, currentId) {
  const select = $('display');
  select.replaceChildren(
    ...displays.map((d) => {
      const opt = document.createElement('option');
      opt.value = String(d.id);
      opt.textContent = d.label;
      return opt;
    }),
  );
  if (displays.some((d) => d.id === currentId)) select.value = String(currentId);
}

function showSettings(s) {
  const z = s.zone;
  const pct = (v) => `${Math.round(v * 100)} %`;
  $('zoneLabel').textContent =
    z.width >= 1 && z.height >= 1
      ? 'plein écran'
      : `${pct(z.width)} × ${pct(z.height)} à partir de (${pct(z.x)}, ${pct(z.y)})`;
  $('sound').checked = s.sound;
  $('volume').value = Math.round(s.volume * 100);
  $('volumeOut').textContent = `${$('volume').value} %`;
  $('opacity').value = Math.round(s.opacity * 100);
  $('opacityOut').textContent = `${$('opacity').value} %`;
  $('maxSizeMb').value = s.maxSizeMb;
}

function setStatus(message, isError = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', isError);
}

async function update(patch) {
  showSettings(await api.setSettings(patch));
}

$('display').addEventListener('change', (e) => update({ displayId: Number(e.target.value) }));
$('editZone').addEventListener('click', () => api.editZone());
$('fullZone').addEventListener('click', () => update({ zone: 'full' }));
$('sound').addEventListener('change', (e) => update({ sound: e.target.checked }));
$('volume').addEventListener('input', (e) => update({ volume: e.target.value / 100 }));
$('opacity').addEventListener('input', (e) => update({ opacity: e.target.value / 100 }));
$('maxSizeMb').addEventListener('change', (e) => update({ maxSizeMb: Number(e.target.value) }));

$('pick').addEventListener('click', async () => {
  const file = await api.pickMedia();
  if (!file) return;
  selectedFile = file;
  $('fileName').textContent = file.split(/[\\/]/).pop();
});

$('send').addEventListener('click', () => {
  const payload = {
    file: selectedFile,
    text: $('text').value,
    imageSeconds: Number($('imageSeconds').value),
  };
  const delay = Math.max(0, Number($('delay').value) || 0);
  setStatus(delay ? `Affichage dans ${delay} s…` : 'Envoi…');
  setTimeout(async () => {
    const result = await api.sendMedia(payload);
    if (!result.ok) return setStatus(result.error, true);
    setStatus(result.position ? `Ajouté à la file (position ${result.position}).` : 'Affiché.');
  }, delay * 1000);
});

api.onSettingsChanged(showSettings);
api.onDisplaysChanged(async () => {
  const { settings, displays } = await api.getSettings();
  fillDisplays(displays, settings.displayId);
});
api.onQueueChanged((n) => {
  if (n > 0) setStatus(`${n} média(s) en attente.`);
});

api.getSettings().then(({ settings, displays }) => {
  fillDisplays(displays, settings.displayId);
  showSettings(settings);
});
