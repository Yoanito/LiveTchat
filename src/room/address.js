// Adresse d'un salon : lt://hôte:port/clé
const PREFIX = 'lt://';

function formatAddress(host, port, key) {
  const h = host.includes(':') ? `[${host}]` : host;
  return `${PREFIX}${h}:${port}/${key}`;
}

function parseAddress(text) {
  const raw = String(text ?? '').trim().replace(/^lt:\/\//i, '');
  const match = raw.match(/^(\[[0-9a-f:.]+\]|[^/:\s]+):(\d{1,5})\/([0-9a-f]{32})$/i);
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return null;
  return { host: match[1].replace(/^\[|\]$/g, ''), port, key: match[3].toLowerCase() };
}

module.exports = { formatAddress, parseAddress };
