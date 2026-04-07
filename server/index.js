import 'dotenv/config';
import { writeSync } from 'node:fs';
import createApp from './app.js';

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // Allow access from any IP on network
const app = createApp();
let shuttingDown = false;
const activeSockets = new Set();

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[startup] pid=${process.pid} server running on http://${HOST}:${PORT}`);
});

server.on('connection', (socket) => {
  activeSockets.add(socket);

  socket.on('close', () => {
    activeSockets.delete(socket);
  });
});

server.on('error', (error) => {
  console.error('Server error:', error);
});

server.on('close', () => {
  console.log('[server] close event emitted');
});

function syncLog(message, stream = 'stdout') {
  const fd = stream === 'stderr' ? 2 : 1;

  try {
    writeSync(fd, `${message}\n`);
  } catch (error) {
    console.error('[logger] failed to write sync log:', error);
  }
}

function gracefulShutdown(source) {
  if (shuttingDown) {
    syncLog(`[shutdown] duplicate request ignored (source=${source})`);
    return;
  }

  shuttingDown = true;
  syncLog(
    `[shutdown] source=${source}; closing HTTP server gracefully... open_connections=${activeSockets.size}`,
  );

  const forceExitTimer = setTimeout(() => {
    syncLog(
      `[shutdown] graceful shutdown timed out after 10s; forcing exit with open_connections=${activeSockets.size}`,
      'stderr',
    );

    for (const socket of activeSockets) {
      socket.destroy();
    }

    process.exit(1);
  }, 10000);

  forceExitTimer.unref();

  const closeLingeringConnectionsTimer = setTimeout(() => {
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }

    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    } else {
      for (const socket of activeSockets) {
        socket.end();
      }
    }
  }, 1500);

  closeLingeringConnectionsTimer.unref();

  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }

  server.close(() => {
    clearTimeout(closeLingeringConnectionsTimer);
    clearTimeout(forceExitTimer);
    syncLog('[shutdown] HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

process.on('beforeExit', (code) => {
  console.log(`[lifecycle] beforeExit code=${code}`);
});

process.on('exit', (code) => {
  console.log(`[lifecycle] exit code=${code}`);
});
