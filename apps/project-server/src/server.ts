import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createProjectsRouter } from './routes/projects.js';
import { createCompilerRouter } from './routes/compiler.js';
import {
  ProjectService,
  ProjectConflictError,
  ProjectNotFoundError,
  ValidationError,
} from './services/project-service.js';
import { CompilerService } from './services/compiler-service.js';

export function createServer(service?: ProjectService, compilerService?: CompilerService): Express {
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

  app.use('/api/projects', createProjectsRouter(service));
  app.use('/api/compiler', createCompilerRouter(compilerService));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      return res.status(400).json({
        error: {
          code: err.code,
          message: err.message,
          details: null,
        },
      });
    }

    if (err instanceof ProjectNotFoundError) {
      return res.status(404).json({
        error: {
          code: err.code,
          message: err.message,
          details: null,
        },
      });
    }

    if (err instanceof ProjectConflictError) {
      return res.status(409).json({
        error: {
          code: err.code,
          message: err.message,
          details: null,
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
