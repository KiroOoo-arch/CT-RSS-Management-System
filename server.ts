import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { closeDatabasePool } from './src/server/config/database.ts';
import { serverConfig } from './src/server/config/env.ts';
import { apiNotFoundHandler, globalErrorHandler } from './src/server/middleware/errorHandler.ts';
import { requestContextMiddleware } from './src/server/middleware/requestContext.ts';
import { apiRouter } from './src/server/routes/index.ts';
import { getSessionSecurityStatus } from './src/server/utils/session.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  if (serverConfig.nodeEnv === 'production' && getSessionSecurityStatus().usingEphemeralFallback) {
    throw new Error(
      'Refusing to start production server without a configured SESSION_SECRET of at least 16 characters.',
    );
  }
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestContextMiddleware);

  // Serve official college seal for direct /favicon.ico browser requests
  const faviconPath = path.resolve(__dirname, 'public/assets/aistudio/image_3e519e56.png');
  app.get('/favicon.ico', (_req, res) => {
    res.sendFile(faviconPath);
  });

  // Versioned REST API
  app.use('/api/v1', apiRouter);

  // Return structured 404 JSON for unmatched API routes
  app.use('/api', apiNotFoundHandler);

  if (serverConfig.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use(globalErrorHandler);

  const server = app.listen(serverConfig.port, '0.0.0.0', () => {
    console.log(
      `[CT-RSS Management System] Server listening on http://0.0.0.0:${serverConfig.port} (${serverConfig.nodeEnv})`,
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[CT-RSS Management System] Received ${signal}; closing HTTP server and DB pool...`);
    server.close(() => {
      closeDatabasePool()
        .catch((err) => console.error('[CT-RSS DB Shutdown Error]', err))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch((error) => {
  console.error('[CT-RSS Management System] Fatal startup error:', error);
  process.exit(1);
});
