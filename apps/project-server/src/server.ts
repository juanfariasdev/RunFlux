import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { createProjectsRouter } from './routes/projects.js';
import { createCompilerRouter } from './routes/compiler.js';
import type { ServerServices } from './container.js';
import { DomainError } from './errors.js';

export function createServer(services: ServerServices): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') {
        const duration = Date.now() - start;
        console.log(`[project-server] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
      }
    });
    next();
  });

  app.use('/api/projects', createProjectsRouter(services.projects));
  app.use('/api/compiler', createCompilerRouter(services.compiler));

  // Interactive webhook testing receiver (E001)
  app.all(['/api/webhooks/test', '/api/webhooks/test/*'], async (req, res) => {
    try {
      const subPath = req.path.replace(/^\/api\/webhooks\/test/, '') || '/webhook';
      const captured = services.webhooks.deliver(subPath, {
        body: req.body,
        headers: req.headers,
        query: req.query,
        method: req.method,
      });
      return res.status(200).json({
        success: true,
        captured,
        message: captured
          ? 'Webhook captured! The waiting test in RunFlux has completed.'
          : `Webhook payload received, but no webhook of a running test waits for ${req.method} ${subPath}.`,
        data: req.body,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) return res.status(err.status).json(err.toBody());

    if (err instanceof ZodError) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PAYLOAD',
          message: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          details: err.errors,
        },
      });
    }

    console.error('[project-server] Internal error:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno no servidor de projetos.',
        details: process.env.NODE_ENV === 'development' ? String(err) : null,
      },
    });
  });

  return app;
}
