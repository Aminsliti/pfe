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

  // Reflect the requesting frontend origin so the app works from localhost or another PC on the LAN.
  app.use(cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, true);
    },
    credentials: true,
  }));
  
  app.use(express.json({ limit: '15mb' }));
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
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'The exported diagram image is too large to attach to the PDF report.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export default createApp;
