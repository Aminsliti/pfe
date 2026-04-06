import 'dotenv/config';
import createApp from './app.js';

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // Allow access from any IP on network
const app = createApp();
let shuttingDown = false;

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

server.on('error', (error) => {
  console.error('Server error:', error);
});

server.on('close', () => {
  console.log('[server] close event emitted');
});

function gracefulShutdown(source) {
  if (shuttingDown) {
    console.log(`[shutdown] duplicate request ignored (source=${source})`);
    return;
  }

  shuttingDown = true;
  console.log(`[shutdown] source=${source}; closing HTTP server gracefully...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[shutdown] graceful shutdown timed out after 10s; forcing exit');
    process.exit(1);
  }, 10000);

  forceExitTimer.unref();

  server.close(() => {
    clearTimeout(forceExitTimer);
    console.log('[shutdown] HTTP server closed');
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
