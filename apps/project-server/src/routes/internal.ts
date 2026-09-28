import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ProjectService } from '../services/project-service.js';

/**
 * Routes for the processes of the platform, never for browsers: mounted outside `/api`, behind
 * `internalGuard`. The process that hosts the editor's test runs reads a project's values here (RN-12).
 */
export function createInternalRouter(projects: ProjectService): Router {
  const router = Router();

  router.get('/projects/:id/environment', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await projects.projectEnvironment(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
