// Page réseau invisible : connexion directe (WebRTC) entre les membres d'un salon.
// Les PC se trouvent via des relais publics Nostr, puis échangent les médias en direct.
import { joinRoom } from 'trystero';

const APP_ID = 'livetchat-v1';
const MB = 1024 * 1024;
// Mémoire réservée aux médias en cours de réception, tous amis confondus.
// Au-delà, les envois suivants attendent leur tour.
const RECEIVE_BUDGET_BYTES = 256 * MB;
// Fréquence max des mises à jour de la progression d'un envoi.
const PROGRESS_INTERVAL_MS = 250;
// Un avertissement de connexion disparaît s'il ne se répète pas (l'ami a peut-être abandonné).
const WARNING_MS = 2 * 60_000;

let room = null;
let me = null; // { id, name, maxSizeMb } : ce que les autres voient de moi
let muted = new Set(); // identifiants des amis dont je refuse les médias (jamais envoyé)
const members = new Map(); // peerId -> { id, name, maxSizeMb }
const warnings = new Map(); // peerId -> { message, timer }
let hello = null;
let media = null;

const emit = (event, payload) => window.net.emit(event, payload);

function publishMembers() {
  emit('members', [...members].map(([peerId, m]) => ({ peerId, ...m })));
}

function publishWarnings() {
  emit('warnings', [...new Set([...warnings.values()].map((w) => w.message))]);
}

// Les erreurs de trystero sont en anglais technique : on les traduit pour l'interface.
function describeError(error) {
  const text = String(error?.message ?? error ?? '');
  if (/could not connect|TURN|ICE/i.test(text)) {
    return "Connexion directe impossible avec un ami : sa box ou son réseau (4G, entreprise, école) la bloque.";
  }
  if (/password|decrypt/i.test(text)) return "Un ami n'a pas pu être vérifié. Vérifiez que vous avez le même code.";
  return 'Problème de connexion avec un ami.';
}

function warn(peerId, error) {
  const key = peerId ?? '';
  clearTimeout(warnings.get(key)?.timer);
  const timer = setTimeout(() => {
    warnings.delete(key);
    publishWarnings();
  }, WARNING_MS);
  warnings.set(key, { message: describeError(error), timer });
  publishWarnings();
}

function clearWarning(peerId) {
  const warning = warnings.get(peerId);
  if (!warning) return;
  clearTimeout(warning.timer);
  warnings.delete(peerId);
  publishWarnings();
}

function join({ code, id, name, maxSizeMb, muted: mutedIds, relayUrls }) {
  leave();
  me = { id, name, maxSizeMb };
  muted = new Set(mutedIds);
  room = joinRoom(
    {
      appId: APP_ID,
      // Le code du salon chiffre aussi les échanges passant par les relais.
      password: code,
      maxReceiveBytes: RECEIVE_BUDGET_BYTES,
      ...(relayUrls?.length ? { relayConfig: { urls: relayUrls } } : {}),
    },
    code,
    {
      onJoinError: ({ error, peerId }) => warn(peerId, error),
    },
  );

  hello = room.makeAction('hello');
  hello.onMessage = (data, { peerId }) => {
    if (!data || typeof data !== 'object') return;
    members.set(peerId, {
      id: String(data.id ?? '').slice(0, 64),
      name: String(data.name ?? '').slice(0, 32) || 'Anonyme',
      maxSizeMb: Number(data.maxSizeMb) || 20,
    });
    publishMembers();
  };

  media = room.makeAction('media');
  // Refusé avant le transfert, sans rien télécharger : envoyeur inconnu ou mis en sourdine,
  // ou fichier plus lourd que ma limite.
  media.onReceive = ({ byteLength, peerId }) => {
    const from = members.get(peerId);
    return Boolean(from) && !muted.has(from.id) && byteLength <= me.maxSizeMb * MB;
  };
  media.onMessage = (data, { peerId, metadata }) => {
    const from = members.get(peerId);
    if (!from || !(data instanceof ArrayBuffer || ArrayBuffer.isView(data))) return;
    emit('media', {
      bytes: data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      ext: metadata?.ext,
      text: metadata?.text,
      imageSeconds: metadata?.imageSeconds,
      from: { id: from.id, name: from.name },
    });
  };

  room.onPeerJoin = (peerId) => {
    clearWarning(peerId);
    hello.send(me, { target: peerId }).catch(() => {});
  };
  room.onPeerLeave = (peerId) => {
    members.delete(peerId);
    publishMembers();
  };

  publishMembers();
  publishWarnings();
}

function leave() {
  room?.leave();
  room = null;
  hello = null;
  media = null;
  members.clear();
  for (const warning of warnings.values()) clearTimeout(warning.timer);
  warnings.clear();
}

// Envoie à chaque ami séparément : un ami qui décroche n'empêche pas les autres de recevoir,
// et l'envoyeur sait qui a reçu quoi.
async function send(cmd) {
  const { requestId, ext, text, imageSeconds } = cmd;
  // Un Blob est lu morceau par morceau : trystero n'en fait pas une copie complète par ami.
  const blob = new Blob([cmd.bytes]);
  cmd.bytes = null;
  if (!room) return emit('sent', { requestId, ok: false, error: "Tu n'es pas dans un salon." });

  // Un ami parti entre-temps n'a rien reçu.
  const targets = cmd.targets.filter((peerId) => members.has(peerId));
  const failed = cmd.targets.filter((peerId) => !members.has(peerId));
  const delivered = [];
  const progress = new Map(targets.map((peerId) => [peerId, 0]));
  let lastReport = 0;
  const report = () => {
    const now = Date.now();
    if (now - lastReport < PROGRESS_INTERVAL_MS) return;
    lastReport = now;
    let sum = 0;
    for (const value of progress.values()) sum += value;
    emit('progress', { requestId, ratio: sum / progress.size });
  };

  const results = await Promise.allSettled(
    targets.map((peerId) =>
      media.send(blob, {
        target: peerId,
        metadata: { ext, text, imageSeconds },
        onProgress: (ratio) => {
          progress.set(peerId, ratio);
          report();
        },
      }),
    ),
  );
  results.forEach((r, i) => (r.status === 'fulfilled' ? delivered : failed).push(targets[i]));
  emit('sent', { requestId, ok: true, delivered, failed });
}

// Pseudo ou limite changés : les autres membres sont prévenus. Les mutes restent locaux.
function updateProfile({ name, maxSizeMb, muted: mutedIds }) {
  if (!me) return;
  muted = new Set(mutedIds);
  if (name === me.name && maxSizeMb === me.maxSizeMb) return;
  me = { ...me, name, maxSizeMb };
  if (room) hello.send(me).catch(() => {});
}

window.net.onCommand((cmd) => {
  if (cmd.type === 'join') join(cmd);
  else if (cmd.type === 'leave') leave();
  else if (cmd.type === 'send') send(cmd);
  else if (cmd.type === 'profile') updateProfile(cmd);
});
