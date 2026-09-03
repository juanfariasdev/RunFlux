import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CompilerService,
  IncompatibleNodesError,
  CompilerValidationError,
} from '../services/compiler-service.js';

export function createCompilerRouter(service = new CompilerService()): Router {
  const router = Router();

  router.post('/compile', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workflow, targetPlatform, target, projectName, skipTests } = req.body;
      const result = await service.compile({
        workflow,
        targetPlatform,
        target,
        projectName,
        skipTests,
      });
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof IncompatibleNodesError) {
        return res.status(400).json({
          error: {
            code: err.code,
            message: err.message,
            details: err.incompatibleNodes,
          },
        });
      }
      if (err instanceof CompilerValidationError) {
        return res.status(400).json({
          error: {
            code: err.code,
            message: err.message,
            details: null,
          },
        });
      }
      return next(err);
    }
  });

  router.get('/downloads/:filename', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filename = decodeURIComponent(req.params.filename);
      const filePath = await service.findZipFile(filename);

      if (!filePath) {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: `Arquivo "${filename}" não encontrado para download.`,
          },
        });
      }

      res.setHeader('Content-Type', 'application/zip');
      return res.download(filePath, filename);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
