// SPDX-License-Identifier: Apache-2.0
const debugPort = Number(process.argv[2] || 0);
if (!Number.isInteger(debugPort) || debugPort <= 0) {
  console.error('usage: node close-player-window.mjs <debug-port>');
  process.exit(2);
}

const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
  signal: AbortSignal.timeout(3000),
});
if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
const targets = await response.json();
const player = targets.find((target) =>
  target.type === 'page' && typeof target.url === 'string' && target.url.includes('/player/'),
);
if (!player?.webSocketDebuggerUrl) throw new Error('player target not found');

await new Promise((resolve, reject) => {
  const socket = new WebSocket(player.webSocketDebuggerUrl);
  const timer = setTimeout(() => {
    try { socket.close(); } catch {}
    reject(new Error('Page.close timeout'));
  }, 4000);
  const finish = (error) => {
    clearTimeout(timer);
    try { socket.close(); } catch {}
    if (error) reject(error); else resolve();
  };
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ id: 1, method: 'Page.close' }));
  }, { once: true });
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.id === 1) finish(message.error ? new Error(message.error.message) : null);
    } catch (error) {
      finish(error);
    }
  });
  socket.addEventListener('error', () => finish(new Error('CDP connection failed')), { once: true });
});

console.log(JSON.stringify({ closed: true, url: player.url }));
