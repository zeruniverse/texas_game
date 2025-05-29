import { Socket } from 'socket.io';

export function setupHeartbeat(socket: Socket, onTimeout: () => void, interval = 10000): void {
  let last = Date.now();
  socket.on('heartbeat', () => {
    last = Date.now();
  });
  const timer = setInterval(() => {
    if (Date.now() - last > interval) {
      clearInterval(timer);
      onTimeout();
    }
  }, interval);
}