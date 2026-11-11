import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { acceptsIpv4, networkUrls, serverUrl } from '../dist/network-urls.js';

const entry = (address, family = 'IPv4', patch = {}) => ({ address, family, internal: false, scopeid: 0, ...patch });
const interfaces = {
  Loopback: [entry('127.0.0.1', 'IPv4', { internal: true }), entry('::1', 'IPv6', { internal: true })],
  Ethernet: [entry('192.168.1.20'), entry('fd00::20', 'IPv6'), entry('fe80::20', 'IPv6', { scopeid: 12 })],
  'Wi-Fi': [entry('192.168.2.30')],
  Tailscale: [entry('100.64.1.2'), entry('fd7a:115c:a1e0::2', 'IPv6')],
  'vEthernet (WSL)': [entry('172.22.0.1')],
  Offline: undefined
};

test('IPv4 wildcard lists every adapter, including VPN and virtual networks', () => {
  assert.deepEqual(networkUrls('0.0.0.0', 49152, interfaces), [
    { url: 'http://192.168.1.20:49152', name: 'Ethernet' },
    { url: 'http://192.168.2.30:49152', name: 'Wi-Fi' },
    { url: 'http://100.64.1.2:49152', name: 'Tailscale' },
    { url: 'http://172.22.0.1:49152', name: 'vEthernet (WSL)' }
  ]);
});

test('IPv6 URLs use brackets, skip scoped addresses, and respect dual-stack detection', () => {
  const ipv6 = networkUrls('::', 41777, interfaces);
  assert.deepEqual(ipv6, [
    { url: 'http://[fd00::20]:41777', name: 'Ethernet' },
    { url: 'http://[fd7a:115c:a1e0::2]:41777', name: 'Tailscale' }
  ]);
  for (const item of ipv6) assert.equal(new URL(item.url).port, '41777');
  assert.equal(networkUrls('::', 41777, interfaces, true).length, 6);
  assert.equal(serverUrl('::1', 41777), 'http://[::1]:41777');
});

test('specific and loopback bindings never advertise unrelated adapters', () => {
  assert.deepEqual(networkUrls('192.168.2.30', 8080, interfaces), [{ url: 'http://192.168.2.30:8080', name: 'Wi-Fi' }]);
  assert.deepEqual(networkUrls('127.0.0.1', 8080, interfaces), []);
  assert.deepEqual(networkUrls('::1', 8080, interfaces), []);
  assert.deepEqual(networkUrls('0.0.0.0', 8080, {}), []);
});

test('duplicate URLs retain all adapter names without repeating the address', () => {
  assert.deepEqual(networkUrls('0.0.0.0', 8080, {
    Ethernet: [entry('192.168.1.20'), entry('192.168.1.20')], Alias: [entry('192.168.1.20')]
  }), [{ url: 'http://192.168.1.20:8080', name: 'Ethernet, Alias' }]);
});

test('IPv4 detection observes this server, not another listener on the same port', async () => {
  const own = createServer(socket => socket.end());
  const other = createServer(socket => socket.end());
  try {
    own.listen({ host: '127.0.0.1', port: 0 });
    other.listen({ host: '127.0.0.1', port: 0 });
    await Promise.all([once(own, 'listening'), once(other, 'listening')]);
    assert.equal(await acceptsIpv4(own.address().port, own), true);
    assert.equal(await acceptsIpv4(other.address().port, own), false);
    assert.equal(own.listenerCount('connection'), 1);
  } finally {
    await Promise.all([own, other].map(server => new Promise(resolve => server.close(resolve))));
  }
});

test('IPv6 wildcard detection distinguishes dual-stack and IPv6-only sockets', async context => {
  for (const ipv6Only of [false, true]) {
    const server = createServer(socket => socket.end());
    try {
      server.listen({ host: '::', port: 0, ipv6Only });
      await once(server, 'listening');
      assert.equal(await acceptsIpv4(server.address().port, server), !ipv6Only);
    } catch (error) {
      if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code)) {
        context.skip('IPv6 is unavailable on this system');
        return;
      }
      throw error;
    } finally {
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  }
});
