import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { createConnection, type Server } from 'node:net';

export function serverUrl(host: string, port: number) {
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export function networkUrls(host: string, port: number,
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces(), ipv4OnIpv6 = false) {
  const addresses = new Map<string, Set<string>>();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.address === '::1' || entry.address.startsWith('127.')) continue;
      const ipv4 = entry.family === 'IPv4';
      const listening = host === '0.0.0.0' ? ipv4
        : host === '::' ? !ipv4 || ipv4OnIpv6 : entry.address === host;
      // Scoped IPv6 URLs are not supported by browsers; use another address on that adapter.
      if (!listening || entry.address.includes('%') || (!ipv4 && entry.scopeid > 0)) continue;
      const url = serverUrl(entry.address, port);
      const names = addresses.get(url) ?? new Set<string>();
      names.add(name);
      addresses.set(url, names);
    }
  }
  return [...addresses].map(([url, names]) => ({ url, name: [...names].join(', ') }));
}

export function acceptsIpv4(port: number, server: Server): Promise<boolean> {
  return new Promise(resolve => {
    const acceptedPorts = new Set<number>();
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (accepted: boolean) => {
      clearTimeout(timer);
      server.off('connection', observe);
      socket.destroy();
      resolve(accepted);
    };
    const observe = (peer: import('node:net').Socket) => {
      if (peer.remoteAddress !== '127.0.0.1' && peer.remoteAddress !== '::ffff:127.0.0.1') return;
      if (peer.remotePort) acceptedPorts.add(peer.remotePort);
      if (socket.localPort && acceptedPorts.has(socket.localPort)) finish(true);
    };
    const timer = setTimeout(() => finish(false), 300);
    server.on('connection', observe);
    socket.once('connect', () => { if (socket.localPort && acceptedPorts.has(socket.localPort)) finish(true); });
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}
