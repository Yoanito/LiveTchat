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
  $('port').value = s.port;
  $('upnp').checked = s.upnp;
  if (document.activeElement !== $('name')) $('name').value = s.name;
  muted = new Set(s.muted);
}

const STATE_LABELS = {
  connecting: 'Connexion…',
  connected: 'Connecté',
  retrying: 'Connexion perdue',
  disconnected: 'Déconnecté',
};

const INTERNET_HELP = {
  pending: 'Ouverture du port sur ta box…',
  upnp: 'Port ouvert automatiquement sur ta box.',
  off: "Ouverture automatique désactivée : ouvre le port TCP {port} vers ce PC dans l'interface de ta box.",
  manual:
    "Ta box n'a pas accepté l'ouverture automatique du port. Ouvre le port TCP {port} vers ce PC dans l'interface de ta box, ou laisse un autre ami héberger.",
  cgnat:
    "Ton fournisseur d'accès partage ton adresse IP avec d'autres clients : tes amis ne pourront pas te joindre depuis Internet. Demande une IP dédiée à ton FAI ou laisse un autre ami héberger.",
};

function showRoom(room) {
  const inRoom = Boolean(room) && room.state !== 'disconnected';
  $('roomOut').hidden = inRoom;
  $('roomIn').hidden = !inRoom;
  $('roomError').textContent = room?.error && room.state !== 'connected' ? room.error : '';
  $('sendRoom').disabled = room?.state !== 'connected';
  if (!inRoom) return;

  const role = room.role === 'host' ? 'Tu héberges ce salon' : 'Tu es dans un salon';
  const limit = room.maxSizeMb ? `, médias jusqu'à ${room.maxSizeMb} Mo` : '';
  $('roomState').textContent = `${role} · ${STATE_LABELS[room.state] ?? room.state}${limit}`;

  $('hostInfo').hidden = room.role !== 'host';
  if (room.role === 'host') {
    $('publicAddress').textContent = room.publicAddress ?? (room.internet === 'pending' ? '…' : 'inconnue');
    $('copyPublic').disabled = !room.publicAddress;
    $('internetHelp').textContent = (INTERNET_HELP[room.internet] ?? '').replace('{port}', room.port);
    $('lanBlock').hidden = !room.lanAddress;
    $('lanAddress').textContent = room.lanAddress ?? '';
  }

  $('members').replaceChildren(
    ...room.members.map((m) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = m.me ? `${m.name} (toi)` : m.name;
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
$('upnp').addEventListener('change', (e) => update({ upnp: e.target.checked }));
$('port').addEventListener('change', (e) => update({ port: Number(e.target.value) }));
$('name').addEventListener('change', (e) => update({ name: e.target.value }));

$('host').addEventListener('click', async () => {
  $('roomError').textContent = '';
  const result = await api.hostRoom();
  if (!result.ok && result.error) $('roomError').textContent = result.error;
});
$('join').addEventListener('click', async () => {
  $('roomError').textContent = '';
  const result = await api.joinRoom($('address').value);
  if (!result.ok && result.error) $('roomError').textContent = result.error;
});
$('address').addEventListener('keydown', (e) => e.key === 'Enter' && $('join').click());
$('leave').addEventListener('click', () => api.leaveRoom());
$('copyPublic').addEventListener('click', () => api.copy($('publicAddress').textContent));
$('copyLan').addEventListener('click', () => api.copy($('lanAddress').textContent));

$('sendRoom').addEventListener('click', async () => {
  setStatus('Envoi…');
  const result = await api.sendToRoom({
    file: selectedFile,
    text: $('text').value,
    imageSeconds: Number($('imageSeconds').value),
  });
  setStatus(result.ok ? 'Envoyé au salon.' : result.error, !result.ok);
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
  $('address').value = settings.lastAddress;
  showRoom(await api.getRoom());
});
