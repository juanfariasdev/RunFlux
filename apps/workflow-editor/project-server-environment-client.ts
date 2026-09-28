import type { ProjectEnvironmentValues } from '@runflux/validation-runtime/node';

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the stored values of a project for a test run, from the project server's internal route
 * (feature 015, D-11, `interfaces/internal-environment.md`). The values are read on every run and
 * never cached, so a value saved a moment ago is the one used.
 */
export class ProjectServerEnvironmentClient {
  private readonly baseUrl: string;
  private readonly apiToken: string | undefined;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, apiToken?: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.baseUrl = baseUrl;
    this.apiToken = apiToken;
    this.timeoutMs = timeoutMs;
  }

  async environmentOf(projectId: string, signal: AbortSignal): Promise<ProjectEnvironmentValues> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/projects/${encodeURIComponent(projectId)}/environment`, {
        headers: this.apiToken ? { Authorization: `Bearer ${this.apiToken}` } : {},
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (timeout.aborted) throw new Error('The project server did not answer in time');
      throw new Error(`Project server is not running on ${this.baseUrl}`);
    }
    if (response.status === 401 || response.status === 403) throw new Error(`The project server refused to give the variables (${response.status})`);
    if (response.status === 404) throw new Error(`Project ${projectId} not found`);
    if (!response.ok) throw new Error(`The project server answered ${response.status}`);
    return (await response.json()) as ProjectEnvironmentValues;
  }
}
