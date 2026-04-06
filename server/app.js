import express from 'express';
import cors from 'cors';
import path from 'path';
import orgchartRoutes from './routes/orgchart.js';
import authRoutes from './routes/auth.js';
import auditRoutes from './routes/audit.js';
import collaborationRoutes from './routes/collaboration.js';
import processRoutes from './routes/processes.js';
import simulationRoutes from './routes/simulations.js';
import { attachRequestUser } from './utils/access.js';

export function createApp({ requestUserMiddleware = attachRequestUser } = {}) {
  const app = express();

  // Configure CORS for network access
  app.use(cors({
    origin: ['http://localhost:5174', 'http://127.0.0.1:5174', /^http:\/\/192\.168\.\d+\.\d+:5174$/],
    credentials: true
  }));
  
  app.use(express.json());
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'server', 'uploads')));

  if (requestUserMiddleware) {
    app.use(requestUserMiddleware);
  }

  app.use('/api', authRoutes);
  app.use('/api', auditRoutes);
  app.use('/api', collaborationRoutes);
  app.use('/api', processRoutes);
  app.use('/api', orgchartRoutes);
  app.use('/api', simulationRoutes);

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');

    app.use(express.static(distPath));

    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export default createApp;
