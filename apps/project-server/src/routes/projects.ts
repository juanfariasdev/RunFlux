import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  ProjectService,
  ProjectConflictError,
  ProjectNotFoundError,
  ValidationError,
} from '../services/project-service.js';

export function createProjectsRouter(service: ProjectService = new ProjectService()): Router {
  const router = Router();

  // 1.1 Listar Projetos
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const archived = req.query.archived === 'true';
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;

      const projects = await service.listProjects({ archived, search });
      res.json(projects);
    } catch (err) {
      next(err);
    }
  });

  // 1.9 Importar Projeto (colocado antes de /:id para não colidir)
  router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const imported = await service.importProject(req.body);
      res.status(201).json(imported);
    } catch (err) {
      next(err);
    }
  });

  // 1.2 Criar Projeto
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, definition } = req.body || {};
      const project = await service.createProject({ name, definition });
      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  });

  // 1.8 Exportar Projeto
  router.get('/:id/export', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const envelope = await service.exportProject(req.params.id);
      const filename = `${envelope.project.name}.runflux.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.json(envelope);
    } catch (err) {
      next(err);
    }
  });

  // 1.5 Arquivar Projeto (Mover para Lixeira)
  router.post('/:id/archive', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const archived = await service.archiveProject(req.params.id);
      res.json({
        id: archived.id,
        archivedAt: archived.archivedAt,
        status: 'archived',
      });
    } catch (err) {
      next(err);
    }
  });

  // 1.6 Restaurar Projeto da Lixeira
  router.post('/:id/restore', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const restored = await service.restoreProject(req.params.id);
      res.json({
        id: restored.id,
        archivedAt: null,
        status: 'active',
      });
    } catch (err) {
      next(err);
    }
  });

  // 1.3 Obter Detalhes do Projeto
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = await service.getProject(req.params.id);
      res.json(project);
    } catch (err) {
      next(err);
    }
  });

  // 1.4 Atualizar Projeto / Salvar Workflow
  router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, definition } = req.body || {};
      const updated = await service.updateProject(req.params.id, { name, definition });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // 1.7 Excluir Projeto Definitivamente (Hard Delete)
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await service.deletePermanently(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
