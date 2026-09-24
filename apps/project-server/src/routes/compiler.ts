import { Router, type NextFunction, type Request, type Response } from 'express';
import { CompilerRequestError, CompilerService } from '../services/compiler-service.js';

export function createCompilerRouter(service = new CompilerService()): Router {
  const router = Router();

  router.post('/compile', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workflow, targetPlatform, target, projectName } = req.body ?? {};
      return res.status(200).json(await service.compile({ workflow, targetPlatform, target, projectName }));
    } catch (err) {
      if (err instanceof CompilerRequestError) {
        return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      }
      return next(err);
    }
  });

  // Express has already decoded the path parameters.
  const download = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { compilation, filename } = req.params;
      const filePath = await service.findZipFile(filename, compilation);
      if (!filePath) {
        return res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: `Arquivo "${filename}" não encontrado para download.` } });
      }
      res.setHeader('Content-Type', 'application/zip');
      return res.download(filePath, filename);
    } catch (err) {
      return next(err);
    }
  };
  router.get('/downloads/:compilation/:filename', download);
  // Earlier download links name only the file; they get the latest compilation that produced it.
  router.get('/downloads/:filename', download);

  return router;
}
