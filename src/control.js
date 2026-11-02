const $ = (id) => document.getElementById(id);
const api = window.livetchat;

let limits = null;
// Fichier choisi, vérifié et prêt à partir (son chemin reste dans le processus principal).
let fileReady = false;
let currentRoom = null;
let sending = false;
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

function refreshButtons() {
  // Désactivé pendant un envoi : un double-clic enverrait le fichier deux fois.
  $('sendRoom').disabled = !currentRoom || !fileReady || sending;
  $('send').disabled = !fileReady;
}

function showRoom(room) {
  currentRoom = room;
  $('roomOut').hidden = Boolean(room);
  $('roomIn').hidden = !room;
  refreshButtons();
  if (!room) return;

  $('roomCode').textContent = room.code;
  // Les avertissements s'affichent même quand d'autres amis sont connectés.
  const help = [...room.warnings];
  if (room.members.length === 0 && help.length === 0) help.push('En attente des amis… Ils doivent entrer le même code.');
  $('roomHelp').textContent = help.join('\n');

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
// Valeur brute : un champ vidé est ignoré par le processus principal, pas ramené à 1 Mo.
$('maxSizeMb').addEventListener('change', (e) => update({ maxSizeMb: e.target.value }));
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

function describeSend({ delivered, failed, skipped, shownHere }) {
  const parts = [];
  if (delivered.length) parts.push(`Envoyé à ${delivered.join(', ')}.`);
  if (failed.length) parts.push(`Pas reçu par ${failed.join(', ')} (déconnecté ou refusé).`);
  if (skipped.length) parts.push(`Trop lourd pour ${skipped.join(', ')}.`);
  if (!delivered.length && !failed.length && !skipped.length) {
    parts.push("Affiché chez toi seulement, personne d'autre dans le salon.");
  }
  if (!shownHere) parts.push("Pas affiché chez toi : file d'attente pleine.");
  return parts.join(' ');
}

$('sendRoom').addEventListener('click', async () => {
  sending = true;
  refreshButtons();
  setStatus('Envoi…');
  let result;
  try {
    result = await api.sendToRoom({
      text: $('text').value,
      imageSeconds: $('imageSeconds').value,
    });
  } finally {
    sending = false;
    refreshButtons();
  }
  if (!result.ok) return setStatus(result.error, true);
  setStatus(describeSend(result), result.failed.length > 0);
});

// Lit les dimensions (et la durée d'une vidéo) sans décoder l'image entière :
// elle n'est jamais ajoutée à la page.
function probe({ url, kind }) {
  return new Promise((resolve) => {
    const el = kind === 'image' ? new Image() : document.createElement('video');
    const done = (info) => {
      el.removeAttribute('src');
      if (kind === 'video') el.load();
      resolve(info);
    };
    el.addEventListener('error', () => done(null));
    if (kind === 'image') {
      el.addEventListener('load', () => done({ width: el.naturalWidth, height: el.naturalHeight }));
    } else {
      el.preload = 'metadata';
      el.muted = true;
      el.addEventListener('loadedmetadata', () =>
        done({ width: el.videoWidth, height: el.videoHeight, seconds: el.duration }),
      );
    }
    el.src = url;
  });
}

// Renvoie { error } si le média ne doit pas partir, sinon { notes } à afficher.
function judge(kind, info) {
  if (!info) return { error: 'Ce fichier ne peut pas être lu (format ou codec non pris en charge).' };
  const size = `${info.width} × ${info.height}`;
  const pixels = info.width * info.height;
  if (kind === 'image') {
    if (pixels > limits.maxImagePixels) {
      return { error: `Image trop grande (${size}). Maximum ${limits.maxImagePixels / 1e6} mégapixels.` };
    }
    return { notes: [size] };
  }
  if (pixels > limits.maxVideoPixels) return { error: `Vidéo trop grande (${size}). Maximum 3840 × 2160.` };
  const notes = [size, `${Math.round(info.seconds)} s`];
  if (info.seconds > limits.maxVideoSeconds) {
    notes.push(`seules les ${limits.maxVideoSeconds} premières secondes seront affichées, mais tout le fichier est envoyé`);
  }
  if (Math.min(info.width, info.height) > 1440) notes.push('vidéo 4K, lourde à afficher pendant un jeu');
  return { notes };
}

$('pick').addEventListener('click', async () => {
  const picked = await api.pickMedia();
  if (!picked) return;
  fileReady = false;
  refreshButtons();
  $('fileNote').hidden = true;
  if (picked.error) {
    $('fileName').textContent = 'Aucun fichier';
    return setStatus(picked.error, true);
  }
  $('fileName').textContent = picked.name;
  const { error, notes } = judge(picked.kind, await probe(picked));
  if (error) return setStatus(error, true);
  setStatus('');
  $('fileNote').textContent = `${(picked.size / 1024 / 1024).toFixed(1)} Mo · ${notes.join(' · ')}`;
  $('fileNote').hidden = false;
  fileReady = true;
  refreshButtons();
});

$('send').addEventListener('click', () => {
  const payload = {
    text: $('text').value,
    imageSeconds: $('imageSeconds').value,
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
  if (n > 0 && !sending) setStatus(`${n} média(s) en attente.`);
});
api.onSendProgress((ratio) => {
  if (sending) setStatus(`Envoi… ${Math.round(ratio * 100)} %`);
});

api.onRoomChanged(showRoom);

api.getSettings().then(async ({ settings, displays, limits: l }) => {
  limits = l;
  fillDisplays(displays, settings.displayId);
  showSettings(settings);
  $('code').value = settings.lastCode;
  showRoom(await api.getRoom());
});
