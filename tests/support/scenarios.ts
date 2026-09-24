import { expect } from 'vitest';
import type { BackendClient, ExampleRequest, ExampleResponse } from './backend-clients';

/** A request to a workflow and what every backend must answer. */
export interface Scenario {
  readonly name: string;
  readonly request: ExampleRequest;
  /** Defaults to 500 with `error`, 200 otherwise. */
  readonly status?: number;
  /** Part of the error message of a failed run. */
  readonly error?: string;
  /** The node whose output answers the request; HTTP backends return it as `result`. */
  readonly respondedBy?: string;
  /** What that output contains: objects match partially, other values exactly. */
  readonly result?: unknown;
  /** Nodes that must have run, and nodes that must not. */
  readonly ran?: readonly string[];
  readonly skipped?: readonly string[];
  /** Only for HTTP backends: routing, authentication and body parsing. */
  readonly httpOnly?: boolean;
  readonly check?: (response: ExampleResponse) => void;
}

/** The scenarios a client can run: the editor's test runs neither route nor authenticate. */
export function scenariosFor(http: boolean, scenarios: readonly Scenario[]): Array<[string, Scenario]> {
  return scenarios.filter((scenario) => http || !(scenario.httpOnly || isHttpStatus(scenario))).map((scenario) => [scenario.name, scenario]);
}

function isHttpStatus(scenario: Scenario): boolean {
  return scenario.status !== undefined && scenario.status !== 200 && scenario.status !== 500;
}

export async function verify(client: BackendClient, scenario: Scenario): Promise<ExampleResponse> {
  const response = await client.send(scenario.request);
  const expectedStatus = scenario.status ?? (scenario.error ? 500 : 200);
  expect(response.status, `${client.name}: ${JSON.stringify(response.body)}`).toBe(expectedStatus);
  if (scenario.error) {
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain(scenario.error);
  }
  const outputs: Record<string, unknown> = response.body?.nodeOutputs ?? {};
  if (scenario.respondedBy) {
    expect(Object.keys(outputs), `${scenario.respondedBy} did not run`).toContain(scenario.respondedBy);
    const output = outputs[scenario.respondedBy];
    if ('result' in scenario) matches(output, scenario.result);
    if (client.http) expect(response.body.result).toEqual(output);
  }
  for (const id of scenario.ran ?? []) expect(Object.keys(outputs)).toContain(id);
  for (const id of scenario.skipped ?? []) expect(Object.keys(outputs)).not.toContain(id);
  scenario.check?.(response);
  return response;
}

function matches(actual: unknown, expected: unknown): void {
  if (expected !== null && typeof expected === 'object') expect(actual).toMatchObject(expected as object);
  else expect(actual).toEqual(expected);
}
