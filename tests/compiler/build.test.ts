import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ExportedProject } from '../support/exported-project';
import { compile, node, PLUGIN_IDS, workflow } from '../support/workflows';

/** Runs a command in the project, returning its combined output when it fails. */
function attempt(command: string, args: string[], cwd: string): string {
  try {
    execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    return '';
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
}

it.each(['local', 'aws'] as const)('exports a %s backend with every plugin that builds with its own script and passes strict TypeScript', async (targetPlatform) => {
  const ids = PLUGIN_IDS.filter((id) => targetPlatform === 'local' || id !== 'trigger-manual-example');
  const project = await ExportedProject.write(await compile(workflow(ids.map((id) => node(id, id))), targetPlatform, "Customer's backend"), { dependencies: 'declared' });
  try {
    expect(attempt('npm', ['run', 'build'], project.directory)).toBe('');
    const script = targetPlatform === 'local'
      ? "import { runWorkflow } from './dist/run.mjs'; console.log(JSON.stringify(await runWorkflow({ body: { id: 42 } }, 'trigger-webhook')));"
      : "import { handler } from './dist/handler.mjs'; const response = await handler({ rawPath: '/webhook', requestContext: { http: { method: 'POST' } }, body: '{\"id\":42}' }); console.log(response.body);";
    const executed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: project.directory, encoding: 'utf8' }));
    expect(executed).toMatchObject({ success: true, result: { id: 42 } });
    expect(attempt('npx', ['--no-install', 'tsc', '--noEmit', '--project', join(project.directory, 'tsconfig.json')], project.directory)).toBe('');
  } finally {
    await project.dispose();
  }
});
