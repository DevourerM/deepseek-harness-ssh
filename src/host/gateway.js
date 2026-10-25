import {createServer, request, Agent} from 'node:http';

// The desktop renderer is dsh-app://app. Its embedded HTTP Host is cross-site.
// CHIPS keeps the native signed HttpOnly credential partitioned to that top
// site, instead of dropping SameSite=Strict cookies in the iframe. No token or
// cookie is manufactured here, and upstream authentication/Origin checks stay.
export function embeddedCookie(cookie) {
  if (!/^dsh-auth-[A-Za-z0-9_-]+=/i.test(cookie) || !/;\s*HttpOnly(?:;|$)/i.test(cookie) || !/;\s*SameSite=Strict(?:;|$)/i.test(cookie)) return cookie;
  let value = cookie.replace(/;\s*SameSite=Strict(?=;|$)/i, '; SameSite=None');
  if (!/;\s*Secure(?:;|$)/i.test(value)) value += '; Secure';
  if (!/;\s*Partitioned(?:;|$)/i.test(value)) value += '; Partitioned';
  return value;
}
const hop = new Set(['connection', 'proxy-connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
function headersOf(headers) { return Object.fromEntries(Object.entries(headers).filter(([name]) => !hop.has(name.toLowerCase()))); }
export async function forwardHttp(connection) {
  let remotePort; const sockets = new Set(), channels = new Set();
  const agent = new Agent({keepAlive: false, maxSockets: 64});
  const dial = callback => {
    connection.client.forwardOut('127.0.0.1', 0, '127.0.0.1', remotePort, (error, channel) => {
      if (channel) { channels.add(channel); channel.once('close', () => channels.delete(channel)); }
      callback(error, channel);
    });
  };
  agent.createConnection = (_options, callback) => { dial(callback); };
  const validHost = req => req.headers.host === `127.0.0.1:${server.address()?.port}`;
  const server = createServer((req, res) => {
    if (!validHost(req)) { res.writeHead(403); res.end('forbidden'); return; }
    if (!remotePort) { res.writeHead(503); res.end('SSH Host is starting'); return; }
    const upstream = request({hostname: '127.0.0.1', port: remotePort, path: req.url, method: req.method, headers: headersOf(req.headers), agent}, response => {
      const headers = headersOf(response.headers);
      if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map(embeddedCookie);
      res.writeHead(response.statusCode || 502, headers); response.pipe(res);
      response.once('error', () => res.destroy()); res.once('close', () => response.destroy());
    });
    upstream.once('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('SSH Host unavailable'); } else res.destroy(); });
    req.once('aborted', () => upstream.destroy()); res.once('close', () => upstream.destroy()); req.pipe(upstream);
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  server.on('upgrade', (req, socket, head) => {
    if (!validHost(req) || !remotePort) { socket.destroy(); return; }
    dial((error, stream) => {
      if (error || socket.destroyed) { stream?.destroy(); socket.destroy(); return; }
      stream.on('error', () => socket.destroy()); socket.once('close', () => stream.destroy()); stream.once('close', () => socket.destroy());
      stream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` + Object.entries(req.headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`).join('') + '\r\n');
      if (head.length) stream.write(head); socket.pipe(stream).pipe(socket);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {port: server.address().port, setRemote: port => { remotePort = port; }, close: () => { for (const socket of sockets) socket.destroy(); for (const channel of channels) channel.destroy(); agent.destroy(); server.close(); }};
}
