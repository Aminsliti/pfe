import 'dotenv/config';
import createApp from './app.js';

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // Allow access from any IP on network
const app = createApp();

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
  console.error('Server error:', error);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
