import type { WorkflowDefinition } from '@runflux/workflow-model';
import { authorizedFetch, bindFetch, type FetchFunction } from './authorized-fetch';

export type TargetPlatform = 'local' | 'aws';

export interface CompileParams {
  workflow: WorkflowDefinition;
  targetPlatform: TargetPlatform;
  projectName?: string;
  options?: {
    includeCli?: boolean;
  };
}

export interface CompileResult {
  status: 'success';
  targetPlatform: TargetPlatform;
  /** Identifies the compilation whose files `downloadUrl` serves. */
  compilationId: string;
  zipFilename: string;
  downloadUrl: string;
  outputDirectory: string;
  manifest: unknown;
  filesCount: number;
}

export interface CompilerApi {
  compile(params: CompileParams): Promise<CompileResult>;
  getDownloadUrl(filename: string, compilationId?: string): string;
  /** Fetches the archive with the platform token and saves it, which a plain link cannot do (D-15). */
  download(filename: string, compilationId?: string): Promise<void>;
}

export class HttpCompilerApiAdapter implements CompilerApi {
  readonly baseUrl: string;
  private readonly send: FetchFunction;

  /**
   * The editor reaches the project server through its own origin, which forwards `/api`, so no
   * cross-origin access is needed (D-04). `send` defaults to `authorizedFetch`.
   */
  constructor(baseUrl: string = '', send: FetchFunction = authorizedFetch) {
    this.baseUrl = baseUrl;
    this.send = bindFetch(send);
  }

  async compile(params: CompileParams): Promise<CompileResult> {
    const res = await this.send(`${this.baseUrl}/api/compiler/compile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow: params.workflow,
        targetPlatform: params.targetPlatform,
        projectName: params.projectName,
        options: params.options,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const message = errData.error?.message || `Compilation error: HTTP ${res.status}`;
      const error = new Error(message) as Error & { code?: string; details?: unknown };
      error.code = errData.error?.code;
      error.details = errData.error?.details;
      throw error;
    }

    return (await res.json()) as CompileResult;
  }

  /** The download of `filename` from one compilation, or from the latest one that produced it. */
  getDownloadUrl(filename: string, compilationId?: string): string {
    const compilation = compilationId ? `${encodeURIComponent(compilationId)}/` : '';
    return `${this.baseUrl}/api/compiler/downloads/${compilation}${encodeURIComponent(filename)}`;
  }

  async download(filename: string, compilationId?: string): Promise<void> {
    const res = await this.send(this.getDownloadUrl(filename, compilationId));
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Download error: HTTP ${res.status}`);
    }
    const url = URL.createObjectURL(await res.blob());
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
