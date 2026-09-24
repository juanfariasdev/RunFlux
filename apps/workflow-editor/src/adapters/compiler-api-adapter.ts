import type { WorkflowDefinition } from '@runflux/workflow-model';

export type TargetPlatform = 'local' | 'aws';

export interface CompileParams {
  workflow: WorkflowDefinition;
  targetPlatform: TargetPlatform;
  projectName?: string;
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
}

export class HttpCompilerApiAdapter implements CompilerApi {
  readonly baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  async compile(params: CompileParams): Promise<CompileResult> {
    const res = await fetch(`${this.baseUrl}/api/compiler/compile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow: params.workflow,
        targetPlatform: params.targetPlatform,
        projectName: params.projectName,
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
}
