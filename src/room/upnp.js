// Ouvre automatiquement le port du salon sur la box (UPnP), si elle le permet.
const SEARCH_TIMEOUT_MS = 8000;

let gateway = null;

async function openPort(port) {
  const { upnpNat } = await import('@achingbrain/nat-port-mapper');
  const client = upnpNat({ description: 'LiveTchat', autoRefresh: true });
  for await (const gw of client.findGateways({ signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) })) {
    if (gw.family !== 'IPv4') continue;
    try {
      for await (const mapping of gw.mapAll(port, { protocol: 'tcp', externalPort: port })) {
        gateway = gw;
        const externalIp = await gw.externalIp().catch(() => mapping.externalHost);
        return { externalIp, externalPort: mapping.externalPort };
      }
    } catch {
      await gw.stop().catch(() => {});
    }
  }
  return null;
}

async function closePort() {
  const gw = gateway;
  gateway = null;
  await gw?.stop().catch(() => {});
}

module.exports = { openPort, closePort };
