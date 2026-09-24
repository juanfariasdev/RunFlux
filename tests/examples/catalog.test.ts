import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleFiles, loadExample, workflowOf, type ExampleProject } from '../support/examples';
import { ExportedProject } from '../support/exported-project';
import { compile, loadPlugins } from '../support/workflows';

const files = await exampleFiles();
const names = files.map((file) => file.replace(/\.runflux\.json$/, ''));

/** Every `$env.NAME` an expression reads and every variable a node names in its parameters. */
function variablesUsed(example: ExampleProject): Set<string> {
  const used = new Set<string>();
  for (const node of example.workflow.nodes) {
    for (const match of JSON.stringify(node.parameters).matchAll(/\$env\.([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(match[1]);
    const { secretEnvVar, connectionEnvVar, authentication } = node.parameters as Record<string, string | undefined>;
    if (secretEnvVar && authentication && authentication !== 'none') used.add(secretEnvVar);
    if (connectionEnvVar) used.add(connectionEnvVar);
  }
  return used;
}

describe('the examples folder', () => {
  it('holds the HTTP, database and Switch examples', () => {
    expect(names).toEqual(['database-crud', 'http-api', 'switch-routing']);
  });
});

describe.each(names)('example %s', (name) => {
  let example: ExampleProject;
  let plugins: Awaited<ReturnType<typeof loadPlugins>>;
  const projects: ExportedProject[] = [];

  beforeAll(async () => {
    [example, plugins] = await Promise.all([loadExample(name), loadPlugins()]);
  });
  afterAll(() => Promise.all(projects.map((project) => project.dispose())));

  it('is a project file the editor imports', () => {
    expect(example).toMatchObject({ schemaVersion: 1, project: { name: expect.stringMatching(/^Example - /) }, workflow: { id: `example-${name}` } });
    expect(Date.parse(example.exportedAt)).not.toBeNaN();
  });

  it('uses installed plugins, unique ids, labels and distinct positions', () => {
    const { nodes } = example.workflow;
    expect(nodes.filter((node) => !plugins.has(node.pluginId as never)).map((node) => node.pluginId)).toEqual([]);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    expect(nodes.filter((node) => !node.appearance?.label).map((node) => node.id)).toEqual([]);
    expect(new Set(nodes.map((node) => `${node.position.x},${node.position.y}`)).size).toBe(nodes.length);
  });

  it('connects only existing nodes through the outputs their plugins declare', () => {
    const byId = new Map(example.workflow.nodes.map((node) => [node.id, node]));
    for (const connection of example.workflow.connections) {
      const source = byId.get(connection.sourceNodeId);
      expect(source, `${connection.sourceNodeId} -> ${connection.targetNodeId}`).toBeDefined();
      expect(byId.has(connection.targetNodeId), `${connection.sourceNodeId} -> ${connection.targetNodeId}`).toBe(true);
      const outputs = plugins.get(source!.pluginId as never)!.manifest.outputs ?? ['main'];
      expect(outputs, `${source!.id} has no output "${connection.sourceOutput}"`).toContain(connection.sourceOutput);
    }
  });

  it('reaches every node from a trigger, so no node sits unconnected', () => {
    const triggers = example.workflow.nodes.filter((node) => plugins.get(node.pluginId as never)!.manifest.category === 'trigger').map((node) => node.id);
    const reached = new Set(triggers);
    for (const id of reached) {
      for (const connection of example.workflow.connections) if (connection.sourceNodeId === id) reached.add(connection.targetNodeId);
    }
    expect(example.workflow.nodes.map((node) => node.id).filter((id) => !reached.has(id))).toEqual([]);
    expect(triggers.length).toBeGreaterThan(1);
  });

  it('declares every environment variable its nodes read, with a description', () => {
    const declared = new Map((example.project.envVars ?? []).map((variable) => [variable.key, variable]));
    expect([...variablesUsed(example)].filter((key) => !declared.has(key))).toEqual([]);
    expect([...declared.values()].filter((variable) => !variable.description).map((variable) => variable.key)).toEqual([]);
  });

  it('compiles into a local backend whose files list its variables, routes and services', async () => {
    const result = await compile(workflowOf(example), 'local', example.project.name);
    const project = await ExportedProject.write(result);
    projects.push(project);
    const env = project.text('.env.example');
    for (const variable of example.project.envVars ?? []) expect(env).toContain(`${variable.key}=`);
    const document = project.json('src/workflow.json');
    const webhooks = example.workflow.nodes.filter((node) => node.pluginId === 'trigger-webhook');
    const schedules = example.workflow.nodes.filter((node) => node.pluginId === 'trigger-cron');
    expect(document.triggers.http).toHaveLength(webhooks.length);
    expect(document.triggers.schedules).toHaveLength(schedules.length);
    const compose = project.text('docker-compose.yml');
    expect(compose.includes('\n  cron:\n')).toBe(schedules.length > 0);
    expect(compose.includes('\n  postgres:\n')).toBe(example.workflow.nodes.some((node) => node.pluginId === 'database-query'));
    for (const trigger of document.triggers.http) expect(project.text('README.md')).toContain(`${trigger.method} http://localhost:3000${trigger.path}`);
  });

  it('compiles into an AWS stack with a function URL for its webhooks and a schedule per cron trigger', async () => {
    const project = await ExportedProject.write(await compile(workflowOf(example), 'aws', example.project.name));
    projects.push(project);
    const infrastructure = project.json('infrastructure.json');
    const { WorkflowStack } = await project.import('lib/workflow-stack.ts');
    const template = Template.fromStack(new WorkflowStack(new App(), infrastructure.stackName, infrastructure, { code: lambda.Code.fromInline('x') }));
    template.resourceCountIs('AWS::Lambda::Url', example.workflow.nodes.some((node) => node.pluginId === 'trigger-webhook') ? 1 : 0);
    template.resourceCountIs('AWS::Scheduler::Schedule', example.workflow.nodes.filter((node) => node.pluginId === 'trigger-cron').length);
    const variables = Object.values(template.findResources('AWS::Lambda::Function'))[0].Properties.Environment.Variables;
    for (const variable of example.project.envVars ?? []) expect(variables).toHaveProperty(variable.key);
  });
});
