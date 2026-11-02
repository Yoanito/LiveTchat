const $ = (id) => document.getElementById(id);
const api = window.livetchat;

let selectedFile = null;
let muted = new Set();

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
  if (document.activeElement !== $('name')) $('name').value = s.name;
  muted = new Set(s.muted);
}

function showRoom(room) {
  $('roomOut').hidden = Boolean(room);
  $('roomIn').hidden = !room;
  $('sendRoom').disabled = !room;
  if (!room) return;

  $('roomCode').textContent = room.code;
  $('roomHelp').textContent =
    room.members.length === 0
      ? room.warning
        ? `Connexion impossible avec un ami : ${room.warning}`
        : 'En attente des amis… Ils doivent entrer le même code.'
      : '';

  const everyone = [{ id: null, name: `${$('name').value.trim() || 'Moi'} (toi)`, me: true }, ...room.members];
  $('members').replaceChildren(
    ...everyone.map((m) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = m.name;
      li.append(name);
      if (!m.me) {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = muted.has(m.id);
        box.addEventListener('change', async () => {
          muted = new Set(await api.setMuted(m.id, box.checked));
        });
        label.append(box, 'Mute');
        li.append(label);
      }
      return li;
    }),
  );
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
$('name').addEventListener('change', (e) => update({ name: e.target.value }));

$('create').addEventListener('click', () => {
  $('roomError').textContent = '';
  api.createRoom();
});
$('join').addEventListener('click', async () => {
  $('roomError').textContent = '';
  const result = await api.joinRoom($('code').value);
  if (!result.ok && result.error) $('roomError').textContent = result.error;
});
$('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('join').click());
$('leave').addEventListener('click', () => api.leaveRoom());
$('copyCode').addEventListener('click', () => api.copy($('roomCode').textContent));

$('sendRoom').addEventListener('click', async () => {
  setStatus('Envoi…');
  const result = await api.sendToRoom({
    file: selectedFile,
    text: $('text').value,
    imageSeconds: Number($('imageSeconds').value),
  });
  if (!result.ok) return setStatus(result.error, true);
  const skipped = result.skipped?.length ? ` Trop lourd pour : ${result.skipped.join(', ')}.` : '';
  setStatus(
    result.delivered ? `Envoyé à ${result.delivered} ami(s).${skipped}` : `Affiché chez toi seulement, personne d'autre dans le salon.${skipped}`,
  );
});

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

api.onRoomChanged(showRoom);

api.getSettings().then(async ({ settings, displays }) => {
  fillDisplays(displays, settings.displayId);
  showSettings(settings);
  $('code').value = settings.lastCode;
  showRoom(await api.getRoom());
});
