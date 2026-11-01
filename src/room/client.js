// Connexion d'un membre au salon (y compris l'hôte, qui se connecte à lui-même).
const { EventEmitter } = require('node:events');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000];
const DOWNLOAD_TTL_MS = 10 * 60_000;

const CLOSE_REASONS = {
  4000: 'Le salon a été fermé par son hôte.',
  4001: "Adresse de salon invalide (la clé ne correspond pas).",
  4003: 'Tu as rejoint ce salon depuis une autre fenêtre.',
};

class RoomClient extends EventEmitter {
  constructor({ host, port, key }, { id, name }) {
    super();
    this.target = { host, port, key };
    this.me = { id, name };
    this.socket = null;
    this.left = false;
    this.attempt = 0;
    this.maxSizeMb = null;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livetchat-recv-'));
  }

  url(pathname, params = {}) {
    const host = this.target.host.includes(':') ? `[${this.target.host}]` : this.target.host;
    const query = new URLSearchParams({ key: this.target.key, ...params });
    return `${host}:${this.target.port}${pathname}?${query}`;
  }

  connect() {
    this.emit('status', { state: 'connecting' });
    const socket = new WebSocket(`ws://${this.url('/')}`, { handshakeTimeout: 8000 });
    this.socket = socket;

    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'hello', id: this.me.id, name: this.me.name }));
    });

    socket.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        this.attempt = 0;
        this.maxSizeMb = msg.maxSizeMb;
        this.emit('status', { state: 'connected' });
        this.emit('room', { maxSizeMb: msg.maxSizeMb });
      } else if (msg.type === 'room') {
        this.maxSizeMb = msg.maxSizeMb;
        this.emit('room', { maxSizeMb: msg.maxSizeMb });
      } else if (msg.type === 'members' && Array.isArray(msg.members)) {
        this.emit('members', msg.members);
      } else if (msg.type === 'media') {
        this.download(msg);
      }
    });

    socket.on('close', (code) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.emit('members', []);
      const final = this.left || code in CLOSE_REASONS;
      if (final) {
        this.emit('status', { state: 'disconnected', error: this.left ? null : CLOSE_REASONS[code] });
        return;
      }
      // Coupure réseau ou hôte injoignable : on retente régulièrement.
      const delay = RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)];
      this.attempt += 1;
      this.emit('status', {
        state: 'retrying',
        error: `Hôte injoignable, nouvelle tentative dans ${delay / 1000} s.`,
      });
      this.retryTimer = setTimeout(() => !this.left && this.connect(), delay);
    });

    socket.on('error', () => {});
  }

  leave() {
    this.left = true;
    clearTimeout(this.retryTimer);
    this.socket?.close();
    fs.rm(this.dir, { recursive: true, force: true }, () => {});
  }

  download(msg) {
    if (!/^[0-9a-f-]{36}$/.test(msg.mediaId) || !/^\.[a-z0-9]{2,4}$/.test(msg.ext)) return;
    const file = path.join(this.dir, msg.mediaId + msg.ext);
    http
      .get(`http://${this.url(`/media/${msg.mediaId}`)}`, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return;
        }
        const out = fs.createWriteStream(file);
        res.pipe(out);
        out.on('finish', () => {
          this.emit('media', {
            file,
            from: msg.from,
            text: msg.text,
            imageSeconds: msg.imageSeconds,
          });
          setTimeout(() => fs.rm(file, { force: true }, () => {}), DOWNLOAD_TTL_MS).unref();
        });
      })
      .on('error', () => {});
  }

  upload(file, { text, imageSeconds }) {
    return new Promise((resolve) => {
      let size;
      try {
        size = fs.statSync(file).size;
      } catch {
        return resolve({ ok: false, error: 'Fichier introuvable.' });
      }
      if (this.maxSizeMb && size > this.maxSizeMb * 1024 * 1024) {
        return resolve({ ok: false, error: `Fichier trop lourd (max ${this.maxSizeMb} Mo dans ce salon).` });
      }
      const ext = path.extname(file).slice(1).toLowerCase();
      const req = http.request(
        `http://${this.url('/media', { from: this.me.id, ext, text: text ?? '', imageSeconds })}`,
        { method: 'POST', headers: { 'Content-Length': size, 'Content-Type': 'application/octet-stream' } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve({ ok: false, error: `Réponse inattendue de l'hôte (${res.statusCode}).` });
            }
          });
        },
      );
      req.on('error', () => resolve({ ok: false, error: "Impossible d'envoyer le fichier à l'hôte." }));
      fs.createReadStream(file).pipe(req);
    });
  }
}

module.exports = { RoomClient };
