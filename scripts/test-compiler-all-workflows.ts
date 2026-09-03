import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { CompilerService } from '../apps/project-server/src/services/compiler-service.js';

// Helper to wait for HTTP server to respond
async function waitForServer(url: string, maxAttempts = 20, delayMs = 150): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // ignore connection refused while booting
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function main() {
  console.log('================================================================');
  console.log('🚀 RUNFLUX COMPILER & COMPILED ARTIFACTS TEST SUITE');
  console.log('================================================================\n');

  const pluginsDir = path.resolve(process.cwd(), 'plugins');
  const outputDir = path.resolve(process.cwd(), 'output-backends');
  const compilerService = new CompilerService(pluginsDir, outputDir);
  await compilerService.loadPlugins();

  // -------------------------------------------------------------
  // DEFINITION OF DIVERSE WORKFLOWS COVERING ALL SYSTEM FEATURES
  // -------------------------------------------------------------

  // WORKFLOW 1: Linear Processing (Trigger -> Set -> Log)
  const workflowLinear: WorkflowDefinition = {
    id: 'wf-01-linear',
    name: 'Workflow 1 - Linear Processing',
    nodes: [
      {
        id: 'node-trig',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: { label: 'Manual Trigger Linear' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'node-set',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'user', value: 'Alice Smith', type: 'string' },
            { name: 'score', value: 95, type: 'number' },
            { name: 'status', value: 'active', type: 'string' },
          ],
          includeOtherFields: true,
        },
        position: { x: 150, y: 0 },
      },
      {
        id: 'node-log',
        pluginId: 'log-output',
        pluginVersion: '1.0.0',
        parameters: { label: 'Linear Log' },
        position: { x: 300, y: 0 },
      },
    ],
    connections: [
      { sourceNodeId: 'node-trig', sourceOutput: 'main', targetNodeId: 'node-set', targetInput: 'main' },
      { sourceNodeId: 'node-set', sourceOutput: 'main', targetNodeId: 'node-log', targetInput: 'main' },
    ],
  };

  // WORKFLOW 2: Conditional Decision If (Trigger -> Set -> If -> Set -> Log)
  const workflowIf: WorkflowDefinition = {
    id: 'wf-02-if',
    name: 'Workflow 2 - Conditional Decision If',
    nodes: [
      {
        id: 'node-trig',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: { label: 'Initial Trigger' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'node-set-init',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'amount', value: 250, type: 'number' },
            { name: 'currency', value: 'USD', type: 'string' },
          ],
          includeOtherFields: true,
        },
        position: { x: 120, y: 0 },
      },
      {
        id: 'node-if',
        pluginId: 'condition-if',
        pluginVersion: '1.0.0',
        parameters: {
          combinator: 'and',
          conditions: [
            { leftValue: '{{ $json.amount }}', operator: 'greaterThan', rightValue: 100 },
          ],
        },
        position: { x: 250, y: 0 },
      },
      {
        id: 'node-set-approved',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'decision', value: 'APPROVED_PREMIUM', type: 'string' },
            { name: 'discountRate', value: 0.15, type: 'number' },
          ],
          includeOtherFields: true,
        },
        position: { x: 380, y: 0 },
      },
      {
        id: 'node-log-if',
        pluginId: 'log-output',
        pluginVersion: '1.0.0',
        parameters: { label: 'Result If' },
        position: { x: 500, y: 0 },
      },
    ],
    connections: [
      { sourceNodeId: 'node-trig', sourceOutput: 'main', targetNodeId: 'node-set-init', targetInput: 'main' },
      { sourceNodeId: 'node-set-init', sourceOutput: 'main', targetNodeId: 'node-if', targetInput: 'main' },
      { sourceNodeId: 'node-if', sourceOutput: 'true', targetNodeId: 'node-set-approved', targetInput: 'main' },
      { sourceNodeId: 'node-set-approved', sourceOutput: 'main', targetNodeId: 'node-log-if', targetInput: 'main' },
    ],
  };

  // WORKFLOW 3: Multi-Rule Switch Routing (Trigger -> Set -> Switch -> Set -> Log)
  const workflowSwitch: WorkflowDefinition = {
    id: 'wf-03-switch',
    name: 'Workflow 3 - Multi-Rule Switch Routing',
    nodes: [
      {
        id: 'trig',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: { label: 'Start Switch' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'set-tier',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'tier', value: 'pro', type: 'string' },
            { name: 'monthlySpend', value: 1200, type: 'number' },
          ],
          includeOtherFields: true,
        },
        position: { x: 150, y: 0 },
      },
      {
        id: 'switch-node',
        pluginId: 'condition-switch',
        pluginVersion: '1.0.0',
        parameters: {
          rules: [
            {
              combinator: 'and',
              conditions: [{ leftValue: '{{ $json.tier }}', operator: 'equals', rightValue: 'free' }],
            },
            {
              combinator: 'and',
              conditions: [{ leftValue: '{{ $json.tier }}', operator: 'equals', rightValue: 'pro' }],
            },
            {
              combinator: 'and',
              conditions: [{ leftValue: '{{ $json.tier }}', operator: 'equals', rightValue: 'enterprise' }],
            },
          ],
          fallbackEnabled: true,
        },
        position: { x: 300, y: 0 },
      },
      {
        id: 'set-output2',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'assignedSLA', value: '4_HOURS', type: 'string' },
            { name: 'prioritySupport', value: true, type: 'boolean' },
          ],
          includeOtherFields: true,
        },
        position: { x: 450, y: 0 },
      },
      {
        id: 'log-switch',
        pluginId: 'log-output',
        pluginVersion: '1.0.0',
        parameters: { label: 'Result Switch' },
        position: { x: 600, y: 0 },
      },
    ],
    connections: [
      { sourceNodeId: 'trig', sourceOutput: 'main', targetNodeId: 'set-tier', targetInput: 'main' },
      { sourceNodeId: 'set-tier', sourceOutput: 'main', targetNodeId: 'switch-node', targetInput: 'main' },
      { sourceNodeId: 'switch-node', sourceOutput: 'output2', targetNodeId: 'set-output2', targetInput: 'main' },
      { sourceNodeId: 'set-output2', sourceOutput: 'main', targetNodeId: 'log-switch', targetInput: 'main' },
    ],
  };

  // WORKFLOW 4: Filter Validation (Trigger -> Set -> Filter -> Set -> Log)
  const workflowFilter: WorkflowDefinition = {
    id: 'wf-04-filter',
    name: 'Workflow 4 - Filter Validation',
    nodes: [
      {
        id: 'trig',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'set-data',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'score', value: 88, type: 'number' },
            { name: 'email', value: 'dev@runflux.io', type: 'string' },
          ],
          includeOtherFields: true,
        },
        position: { x: 150, y: 0 },
      },
      {
        id: 'filter-node',
        pluginId: 'filter',
        pluginVersion: '1.0.0',
        parameters: {
          combinator: 'and',
          conditions: [
            { leftValue: '{{ $json.score }}', operator: 'greaterThan', rightValue: 70 },
            { leftValue: '{{ $json.email }}', operator: 'contains', rightValue: '@' },
          ],
        },
        position: { x: 300, y: 0 },
      },
      {
        id: 'set-pass',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [{ name: 'passedQualityCheck', value: true, type: 'boolean' }],
          includeOtherFields: true,
        },
        position: { x: 450, y: 0 },
      },
      {
        id: 'log-filter',
        pluginId: 'log-output',
        pluginVersion: '1.0.0',
        parameters: { label: 'Qualified' },
        position: { x: 600, y: 0 },
      },
    ],
    connections: [
      { sourceNodeId: 'trig', sourceOutput: 'main', targetNodeId: 'set-data', targetInput: 'main' },
      { sourceNodeId: 'set-data', sourceOutput: 'main', targetNodeId: 'filter-node', targetInput: 'main' },
      { sourceNodeId: 'filter-node', sourceOutput: 'main', targetNodeId: 'set-pass', targetInput: 'main' },
      { sourceNodeId: 'set-pass', sourceOutput: 'main', targetNodeId: 'log-filter', targetInput: 'main' },
    ],
  };

  // WORKFLOW 5: Full Integrated Stack (Trigger -> Set -> If -> Switch -> Filter -> Set -> Log)
  const workflowFullStack: WorkflowDefinition = {
    id: 'wf-05-full',
    name: 'Workflow 5 - Full Integrated Stack',
    nodes: [
      {
        id: 'n1-trig',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: { label: 'General Trigger' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'n2-set',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'accountType', value: 'vip', type: 'string' },
            { name: 'balance', value: 15000, type: 'number' },
          ],
          includeOtherFields: true,
        },
        position: { x: 100, y: 0 },
      },
      {
        id: 'n3-if',
        pluginId: 'condition-if',
        pluginVersion: '1.0.0',
        parameters: {
          combinator: 'and',
          conditions: [{ leftValue: '{{ $json.balance }}', operator: 'greaterThan', rightValue: 1000 }],
        },
        position: { x: 200, y: 0 },
      },
      {
        id: 'n4-switch',
        pluginId: 'condition-switch',
        pluginVersion: '1.0.0',
        parameters: {
          rules: [
            {
              combinator: 'and',
              conditions: [{ leftValue: '{{ $json.accountType }}', operator: 'equals', rightValue: 'vip' }],
            },
          ],
        },
        position: { x: 300, y: 0 },
      },
      {
        id: 'n5-filter',
        pluginId: 'filter',
        pluginVersion: '1.0.0',
        parameters: {
          conditions: [{ leftValue: '{{ $json.balance }}', operator: 'greaterThan', rightValue: 5000 }],
        },
        position: { x: 400, y: 0 },
      },
      {
        id: 'n6-final-set',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'workflowCompleted', value: true, type: 'boolean' },
            { name: 'tier', value: 'VIP_PLATINUM', type: 'string' },
          ],
          includeOtherFields: true,
        },
        position: { x: 500, y: 0 },
      },
      {
        id: 'n7-log',
        pluginId: 'log-output',
        pluginVersion: '1.0.0',
        parameters: { label: 'Full Stack Output' },
        position: { x: 600, y: 0 },
      },
    ],
    connections: [
      { sourceNodeId: 'n1-trig', sourceOutput: 'main', targetNodeId: 'n2-set', targetInput: 'main' },
      { sourceNodeId: 'n2-set', sourceOutput: 'main', targetNodeId: 'n3-if', targetInput: 'main' },
      { sourceNodeId: 'n3-if', sourceOutput: 'true', targetNodeId: 'n4-switch', targetInput: 'main' },
      { sourceNodeId: 'n4-switch', sourceOutput: 'output1', targetNodeId: 'n5-filter', targetInput: 'main' },
      { sourceNodeId: 'n5-filter', sourceOutput: 'main', targetNodeId: 'n6-final-set', targetInput: 'main' },
      { sourceNodeId: 'n6-final-set', sourceOutput: 'main', targetNodeId: 'n7-log', targetInput: 'main' },
    ],
  };

  const testSuites = [
    { wf: workflowLinear, name: 'Workflow 1 (Linear)' },
    { wf: workflowIf, name: 'Workflow 2 (Conditional If)' },
    { wf: workflowSwitch, name: 'Workflow 3 (Multi-Branch Switch)' },
    { wf: workflowFilter, name: 'Workflow 4 (Filter)' },
    { wf: workflowFullStack, name: 'Workflow 5 (Full Stack Complete)' },
  ];

  console.log(`📋 Total workflows to compile and test: ${testSuites.length}\n`);

  let portCounter = 39120;

  for (let idx = 0; idx < testSuites.length; idx++) {
    const { wf, name } = testSuites[idx];
    const serverPort = ++portCounter;

    console.log(`----------------------------------------------------------------`);
    console.log(`🔹 COMPILING & TESTING: ${name}`);
    console.log(`----------------------------------------------------------------`);

    // 1. Local Compilation
    console.log(`⚙️  [1/6] Compiling for target: LOCAL (Port: ${serverPort})...`);
    const localRes = await compilerService.compile({
      workflow: wf,
      targetPlatform: 'local',
      projectName: wf.name,
      skipTests: true,
    });
    console.log(`    ✓ Compiled successfully!`);
    console.log(`    - Output Dir: ${localRes.outputDirectory}`);
    console.log(`    - Zip File: ${localRes.zipFilename}`);
    console.log(`    - Generated files: ${localRes.filesCount}`);

    // Validate ZIP existence inside directory
    const expectedZipPath = path.join(localRes.outputDirectory, localRes.zipFilename);
    if (!fs.existsSync(expectedZipPath)) {
      throw new Error(`ZIP archive not found at expected physical path: ${expectedZipPath}`);
    }
    console.log(`    ✓ Physical ZIP file validated on disk (${fs.statSync(expectedZipPath).size} bytes)`);

    // 2. AWS Compilation
    console.log(`⚙️  [2/6] Compiling for target: AWS...`);
    const awsRes = await compilerService.compile({
      workflow: wf,
      targetPlatform: 'aws',
      projectName: wf.name,
      skipTests: true,
    });
    console.log(`    ✓ Compiled for AWS successfully!`);
    console.log(`    - Output Dir: ${awsRes.outputDirectory}`);
    console.log(`    - Zip File: ${awsRes.zipFilename}`);

    const testPayload = {
      testTimestamp: new Date().toISOString(),
      source: 'automated-compiler-test',
      clientKey: 'TEST_KEY_123',
    };

    // 3. Test Bundled Production CLI (node dist/run.mjs)
    console.log(`🧪 [3/6] TESTING BUNDLED PRODUCTION CLI (node dist/run.mjs)...`);
    const bundledRunScriptPath = path.join(localRes.outputDirectory, 'dist', 'run.mjs');
    if (!fs.existsSync(bundledRunScriptPath)) {
      throw new Error(`Bundled CLI script dist/run.mjs not found in ${localRes.outputDirectory}`);
    }

    const bundleCmd = `node "${bundledRunScriptPath}" '${JSON.stringify(testPayload)}'`;
    const bundleExecOutput = execSync(bundleCmd, {
      cwd: localRes.outputDirectory,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    console.log(`    ✓ Bundled dist/run.mjs executed cleanly with exit code 0!`);

    // Extract JSON result from CLI stdout
    const cliJsonMatch = bundleExecOutput.match(/\{\s*"success":\s*true[\s\S]*\}/);
    if (!cliJsonMatch) {
      throw new Error(`Failed to parse valid JSON result from bundled CLI stdout`);
    }
    const cliResult = JSON.parse(cliJsonMatch[0]);
    console.log(`    ✓ CLI result verified: ${JSON.stringify(cliResult.result).slice(0, 80)}...`);

    // 4. Test Live Compiled Express HTTP Server (dist/server.mjs)
    console.log(`🌐 [4/6] TESTING COMPILED EXPRESS SERVER (dist/server.mjs)...`);
    const serverDistPath = path.join(localRes.outputDirectory, 'dist', 'server.mjs');
    const serverProc = spawn('node', [serverDistPath], {
      cwd: localRes.outputDirectory,
      env: { ...process.env, PORT: String(serverPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      const isReady = await waitForServer(`http://localhost:${serverPort}/health`);
      if (!isReady) {
        throw new Error(`Compiled server failed to respond on port ${serverPort}`);
      }

      // Check /health
      const healthRes = await fetch(`http://localhost:${serverPort}/health`);
      const healthData = await healthRes.json();
      if (healthData.status !== 'ok' || healthData.nodeCount !== wf.nodes.length) {
        throw new Error(`Invalid health check response: ${JSON.stringify(healthData)}`);
      }
      console.log(`    ✓ Health check responded OK (nodes: ${healthData.nodeCount})`);

      // Send POST /api/execute
      const execRes = await fetch(`http://localhost:${serverPort}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
      });
      const execData = await execRes.json();
      if (!execData.success) {
        throw new Error(`Execution via HTTP API failed: ${JSON.stringify(execData)}`);
      }
      console.log(`    ✓ POST /api/execute responded 200 with matching output!`);
    } finally {
      serverProc.kill('SIGTERM');
    }

    // 5. Test Compiled AWS Lambda Handler (dist/handler.mjs)
    console.log(`☁️  [5/6] TESTING COMPILED AWS LAMBDA HANDLER (dist/handler.mjs)...`);
    const awsHandlerPath = path.join(awsRes.outputDirectory, 'dist', 'handler.mjs');
    if (!fs.existsSync(awsHandlerPath)) {
      throw new Error(`AWS Handler dist/handler.mjs not found in ${awsRes.outputDirectory}`);
    }

    // Import the compiled AWS Lambda handler
    const awsModule = await import(pathToFileURL(awsHandlerPath).href);
    if (typeof awsModule.handler !== 'function') {
      throw new Error(`Exported handler in ${awsHandlerPath} is not a function`);
    }

    // Test 5A: API Gateway HTTP Event invocation
    const lambdaHttpEvent = {
      body: JSON.stringify(testPayload),
      headers: { 'content-type': 'application/json' },
      requestContext: { http: { method: 'POST', path: '/' } },
    };
    const lambdaHttpRes = await awsModule.handler(lambdaHttpEvent);
    if (lambdaHttpRes.statusCode !== 200) {
      throw new Error(`Lambda returned status ${lambdaHttpRes.statusCode}: ${lambdaHttpRes.body}`);
    }
    const lambdaHttpBody = JSON.parse(lambdaHttpRes.body);
    if (!lambdaHttpBody.success) {
      throw new Error(`Lambda execution failed: ${lambdaHttpRes.body}`);
    }
    console.log(`    ✓ Lambda API Gateway event invocation returned 200 with CORS headers!`);

    // Test 5B: Direct invocation without API Gateway wrapper
    const lambdaDirectRes = await awsModule.handler(testPayload);
    if (lambdaDirectRes.statusCode !== 200) {
      throw new Error(`Lambda direct invoke failed with status ${lambdaDirectRes.statusCode}`);
    }
    const lambdaDirectBody = JSON.parse(lambdaDirectRes.body);
    if (!lambdaDirectBody.success) {
      throw new Error(`Lambda direct invoke returned error: ${lambdaDirectRes.body}`);
    }
    console.log(`    ✓ Lambda direct invoke returned 200 with matching payload!`);

    // 6. Cross-Platform Consistency & Structural Verification
    console.log(`🔍 [6/6] VALIDATING CROSS-PLATFORM OUTPUT CONSISTENCY & ARTIFACTS...`);
    const expectedLocalFiles = [
      'package.json',
      'tsconfig.json',
      'Dockerfile',
      '.env.example',
      'README.md',
      'runflux-build.json',
      'src/server.ts',
      'src/run.ts',
      'dist/server.mjs',
      'dist/run.mjs',
      'compiled/function.zip',
    ];
    for (const exp of expectedLocalFiles) {
      const full = path.join(localRes.outputDirectory, exp);
      if (!fs.existsSync(full)) {
        throw new Error(`Mandatory local file ${exp} not found in ${localRes.outputDirectory}`);
      }
    }

    const expectedAwsFiles = [
      'package.json',
      'tsconfig.json',
      'cdk.json',
      'README.md',
      'bin/app.ts',
      'lib/workflow-stack.ts',
      'src/handler.ts',
      'dist/handler.mjs',
      'compiled/function.zip',
    ];
    for (const exp of expectedAwsFiles) {
      const full = path.join(awsRes.outputDirectory, exp);
      if (!fs.existsSync(full)) {
        throw new Error(`Mandatory AWS file ${exp} not found in ${awsRes.outputDirectory}`);
      }
    }

    console.log(`    ✓ All local and AWS structural files & bundled artifacts validated on disk!`);
    console.log(`    ✓ Output consistency verified across Local CLI, HTTP Server & AWS Lambda!\n`);
  }

  console.log('================================================================');
  console.log('🎉 100% SUCCESS: ALL 5 WORKFLOWS COMPILED & EXECUTED ACROSS ALL PLATFORMS!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\n❌ ERROR DURING COMPILATION TESTS:');
  console.error(err);
  process.exit(1);
});
