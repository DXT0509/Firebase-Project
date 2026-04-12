import { WebSocketServer } from 'ws';

const port = process.env.PORT || 3001;
const wss = new WebSocketServer({ port });

console.log(`WebSocket server listening on ws://localhost:${port}`);

wss.on('connection', (ws) => {
  console.log('client connected');

  ws.on('message', (data) => {
    // broadcast to all other clients
    try {
      const text = typeof data === 'string' ? data : data.toString();
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === client.OPEN) {
          client.send(text);
        }
      }
    } catch (e) {
      console.error('error broadcasting message', e);
    }
  });

  ws.on('close', () => console.log('client disconnected'));
});
