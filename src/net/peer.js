// Page réseau invisible : connexion directe (WebRTC) entre les membres d'un salon.
// Les PC se trouvent via des relais publics Nostr, puis échangent les médias en direct.
import { joinRoom } from 'trystero';

const APP_ID = 'livetchat-v1';

let room = null;
let me = null; // { id, name, maxSizeMb }
const members = new Map(); // peerId -> { id, name, maxSizeMb }
let hello = null;
let media = null;

const emit = (event, payload) => window.net.emit(event, payload);

function publishMembers() {
  emit('members', [...members.values()]);
}

function join({ code, id, name, maxSizeMb, relayUrls }) {
  leave();
  me = { id, name, maxSizeMb };
  room = joinRoom(
    {
      appId: APP_ID,
      // Le code du salon chiffre aussi les échanges passant par les relais.
      password: code,
      maxReceiveBytes: 512 * 1024 * 1024,
      ...(relayUrls?.length ? { relayConfig: { urls: relayUrls } } : {}),
    },
    code,
    {
      onJoinError: ({ error }) => emit('warning', String(error?.message ?? error ?? 'Connexion impossible.')),
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
  // Chacun refuse les fichiers plus lourds que sa propre limite.
  media.onReceive = ({ byteLength }) => byteLength <= me.maxSizeMb * 1024 * 1024;
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

  room.onPeerJoin = (peerId) => hello.send(me, { target: peerId });
  room.onPeerLeave = (peerId) => {
    members.delete(peerId);
    publishMembers();
  };

  publishMembers();
}

function leave() {
  room?.leave();
  room = null;
  members.clear();
}

async function send({ requestId, bytes, ext, text, imageSeconds }) {
  if (!room) return emit('sent', { requestId, ok: false, error: "Tu n'es pas dans un salon." });
  const size = bytes.byteLength;
  const targets = [];
  const skipped = [];
  for (const [peerId, member] of members) {
    if (size <= member.maxSizeMb * 1024 * 1024) targets.push(peerId);
    else skipped.push(member.name);
  }
  if (targets.length === 0) {
    return emit('sent', { requestId, ok: true, delivered: 0, skipped });
  }
  try {
    await media.send(bytes, { target: targets, metadata: { ext, text, imageSeconds } });
    emit('sent', { requestId, ok: true, delivered: targets.length, skipped });
  } catch (err) {
    emit('sent', { requestId, ok: false, error: `Envoi interrompu (${err?.message ?? err}).` });
  }
}

window.net.onCommand((cmd) => {
  if (cmd.type === 'join') join(cmd);
  else if (cmd.type === 'leave') leave();
  else if (cmd.type === 'send') send(cmd);
  else if (cmd.type === 'limit' && me) {
    me.maxSizeMb = cmd.maxSizeMb;
    if (room) hello.send(me);
  }
});
