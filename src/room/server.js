// Serveur du salon, lancé par celui qui héberge.
// HTTP pour transférer les fichiers, WebSocket pour la présence et les annonces.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { MEDIA_EXT, MAX_TEXT_LENGTH, MAX_NAME_LENGTH } = require('./protocol');

const MEDIA_TTL_MS = 10 * 60_000;

class RoomServer {
  constructor() {
    this.key = crypto.randomBytes(16).toString('hex');
    this.members = new Map(); // socket -> { id, name }
    this.media = new Map(); // mediaId -> { file, createdAt }
    this.maxSizeMb = 20;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livetchat-host-'));
    this.http = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.http, maxPayload: 64 * 1024 });
    this.wss.on('connection', (socket, req) => this.handleSocket(socket, req));
    // Les erreurs d'écoute (port déjà pris…) sont gérées par listen() : ne pas planter.
    this.wss.on('error', () => {});
    this.cleanup = setInterval(() => this.dropOldMedia(), 60_000);
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(port, '0.0.0.0', () => {
        this.http.off('error', reject);
        resolve(this.http.address().port);
      });
    });
  }

  async stop() {
    clearInterval(this.cleanup);
    for (const socket of this.members.keys()) socket.close(4000, 'Salon fermé');
    this.wss.close();
    await new Promise((resolve) => this.http.close(resolve));
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  setMaxSize(mb) {
    this.maxSizeMb = mb;
    this.broadcast({ type: 'room', maxSizeMb: mb });
  }

  // ---------- WebSocket ----------

  handleSocket(socket, req) {
    const url = new URL(req.url, 'http://x');
    if (!this.validKey(url.searchParams.get('key'))) {
      socket.close(4001, 'Clé invalide');
      return;
    }
    const helloTimeout = setTimeout(() => socket.close(4002, 'Pas de présentation'), 5000);

    socket.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === 'hello' && !this.members.has(socket)) {
        clearTimeout(helloTimeout);
        const id = String(msg.id ?? '').slice(0, 64) || crypto.randomUUID();
        // Un même appareil qui se reconnecte remplace son ancienne connexion.
        for (const [other, member] of this.members) {
          if (member.id === id) other.close(4003, 'Reconnecté ailleurs');
        }
        const name = String(msg.name ?? '').trim().slice(0, MAX_NAME_LENGTH) || 'Anonyme';
        this.members.set(socket, { id, name });
        this.send(socket, { type: 'welcome', maxSizeMb: this.maxSizeMb });
        this.broadcastMembers();
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimeout);
      if (this.members.delete(socket)) this.broadcastMembers();
    });
    socket.on('error', () => {});
  }

  send(socket, msg) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    for (const socket of this.members.keys()) this.send(socket, msg);
  }

  broadcastMembers() {
    this.broadcast({ type: 'members', members: [...this.members.values()] });
  }

  // ---------- HTTP ----------

  validKey(key) {
    const a = Buffer.from(String(key ?? ''));
    const b = Buffer.from(this.key);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  memberById(id) {
    for (const member of this.members.values()) if (member.id === id) return member;
    return null;
  }

  handleHttp(req, res) {
    const url = new URL(req.url, 'http://x');
    const fail = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: message }));
    };
    if (!this.validKey(url.searchParams.get('key'))) return fail(403, 'Clé invalide.');

    if (req.method === 'POST' && url.pathname === '/media') return this.receiveUpload(req, res, url, fail);

    const download = url.pathname.match(/^\/media\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && download) {
      const entry = this.media.get(download[1]);
      if (!entry) return fail(404, 'Média expiré.');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      fs.createReadStream(entry.file).pipe(res);
      return;
    }
    fail(404, 'Introuvable.');
  }

  receiveUpload(req, res, url, fail) {
    const sender = this.memberById(url.searchParams.get('from'));
    if (!sender) return fail(403, "Tu n'es pas connecté au salon.");
    const ext = `.${String(url.searchParams.get('ext') ?? '').toLowerCase()}`;
    if (!MEDIA_EXT.includes(ext)) return fail(415, 'Format non pris en charge.');
    const limit = this.maxSizeMb * 1024 * 1024;
    if (Number(req.headers['content-length']) > limit) {
      return fail(413, `Fichier trop lourd (max ${this.maxSizeMb} Mo dans ce salon).`);
    }

    const mediaId = crypto.randomUUID();
    const file = path.join(this.dir, mediaId + ext);
    const out = fs.createWriteStream(file);
    let size = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit && !aborted) {
        aborted = true;
        out.destroy();
        fs.rm(file, { force: true }, () => {});
        fail(413, `Fichier trop lourd (max ${this.maxSizeMb} Mo dans ce salon).`);
        req.destroy();
      }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (aborted) return;
      this.media.set(mediaId, { file, createdAt: Date.now() });
      this.broadcast({
        type: 'media',
        mediaId,
        ext,
        from: { id: sender.id, name: sender.name },
        text: String(url.searchParams.get('text') ?? '').slice(0, MAX_TEXT_LENGTH),
        imageSeconds: Number(url.searchParams.get('imageSeconds')) || 5,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    out.on('error', () => !aborted && fail(500, "Impossible d'enregistrer le fichier."));
  }

  dropOldMedia() {
    const now = Date.now();
    for (const [id, entry] of this.media) {
      if (now - entry.createdAt > MEDIA_TTL_MS) {
        this.media.delete(id);
        fs.rm(entry.file, { force: true }, () => {});
      }
    }
  }
}

module.exports = { RoomServer };
