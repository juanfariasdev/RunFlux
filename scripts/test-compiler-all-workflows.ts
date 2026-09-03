import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { CompilerService } from '../apps/project-server/src/services/compiler-service.js';

async function main() {
  console.log('================================================================');
  console.log('🚀 TESTE END-TO-END DE COMPILAÇÃO E EXECUÇÃO DE FLUXOS RUNFLUX');
  console.log('================================================================\n');

  const pluginsDir = path.resolve(process.cwd(), 'plugins');
  const outputDir = path.resolve(process.cwd(), 'output-backends');
  const compilerService = new CompilerService(pluginsDir, outputDir);
  await compilerService.loadPlugins();

  // -------------------------------------------------------------
  // DEFINIÇÃO DOS DIVERSOS FLUXOS EXPLORANDO TODOS OS RECURSOS
  // -------------------------------------------------------------

  // FLUXO 1: Linear Data Processing (Trigger -> Set -> Log)
  const workflowLinear: WorkflowDefinition = {
    id: 'wf-01-linear',
    name: 'Fluxo 1 - Processamento Linear',
    nodes: [
      {
        id: 'node-trig',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: { label: 'Disparo Manual Linear' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'node-set',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'user', value: 'Alice Silva', type: 'string' },
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
        parameters: { label: 'Log Linear' },
        position: { x: 300, y: 0 },
      },
    ],
    connections: [
      { sourceNodeId: 'node-trig', sourceOutput: 'main', targetNodeId: 'node-set', targetInput: 'main' },
      { sourceNodeId: 'node-set', sourceOutput: 'main', targetNodeId: 'node-log', targetInput: 'main' },
    ],
  };

  // FLUXO 2: Branching Condicional com If (Trigger -> Set -> If -> Set -> Log)
  const workflowIf: WorkflowDefinition = {
    id: 'wf-02-if',
    name: 'Fluxo 2 - Decisao Condicional If',
    nodes: [
      {
        id: 'node-trig',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: { label: 'Disparo Inicial' },
        position: { x: 0, y: 0 },
      },
      {
        id: 'node-set-init',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: {
          fields: [
            { name: 'amount', value: 250, type: 'number' },
            { name: 'currency', value: 'BRL', type: 'string' },
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
            { name: 'decision', value: 'APROVADO_PREMIUM', type: 'string' },
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
        parameters: { label: 'Resultado If' },
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

  // FLUXO 3: Multi-branch Switch (Trigger -> Set -> Switch -> Set -> Log)
  const workflowSwitch: WorkflowDefinition = {
    id: 'wf-03-switch',
    name: 'Fluxo 3 - Roteamento Multi-Regra Switch',
    nodes: [
      {
        id: 'trig',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: { label: 'Inicio Switch' },
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
        parameters: { label: 'Resultado Switch' },
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

  // FLUXO 4: Filtro de Validação (Trigger -> Set -> Filter -> Set -> Log)
  const workflowFilter: WorkflowDefinition = {
    id: 'wf-04-filter',
    name: 'Fluxo 4 - Validacao com Filtro',
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
        parameters: { label: 'Qualificado' },
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

  // FLUXO 5: Full Stack com Todos os Nós (Trigger -> Set -> If -> Switch -> Filter -> Set -> Log)
  const workflowFullStack: WorkflowDefinition = {
    id: 'wf-05-full',
    name: 'Fluxo 5 - Integrado Completo RunFlux',
    nodes: [
      {
        id: 'n1-trig',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: { label: 'Disparo Geral' },
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
        parameters: { label: 'Conclusao Full Stack' },
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
    { wf: workflowLinear, name: 'Fluxo 1 (Linear)' },
    { wf: workflowIf, name: 'Fluxo 2 (If Condicional)' },
    { wf: workflowSwitch, name: 'Fluxo 3 (Switch Multi-Branch)' },
    { wf: workflowFilter, name: 'Fluxo 4 (Filtro)' },
    { wf: workflowFullStack, name: 'Fluxo 5 (Full Stack Completo)' },
  ];

  console.log(`📋 Total de fluxos a compilar e testar: ${testSuites.length}\n`);

  for (const { wf, name } of testSuites) {
    console.log(`----------------------------------------------------------------`);
    console.log(`🔹 COMPILANDO E TESTANDO: ${name}`);
    console.log(`----------------------------------------------------------------`);

    // 1. Compilação Local
    console.log(`⚙️  [1/4] Compilando para target: LOCAL...`);
    const localRes = await compilerService.compile({
      workflow: wf,
      targetPlatform: 'local',
      projectName: wf.name,
      skipTests: true,
    });
    console.log(`    ✓ Compilado com sucesso!`);
    console.log(`    - Output Dir: ${localRes.outputDirectory}`);
    console.log(`    - Zip File: ${localRes.zipFilename}`);
    console.log(`    - Arquivos gerados: ${localRes.filesCount}`);

    // Validação da existência do zip dentro da pasta
    const expectedZipPath = path.join(localRes.outputDirectory, localRes.zipFilename);
    if (!fs.existsSync(expectedZipPath)) {
      throw new Error(`Arquivo ZIP não encontrado no destino físico esperado: ${expectedZipPath}`);
    }
    console.log(`    ✓ Arquivo ZIP validado no disco (${fs.statSync(expectedZipPath).size} bytes)`);

    // 2. Compilação AWS
    console.log(`⚙️  [2/4] Compilando para target: AWS...`);
    const awsRes = await compilerService.compile({
      workflow: wf,
      targetPlatform: 'aws',
      projectName: wf.name,
      skipTests: true,
    });
    console.log(`    ✓ Compilado para AWS com sucesso!`);
    console.log(`    - Output Dir: ${awsRes.outputDirectory}`);
    console.log(`    - Zip File: ${awsRes.zipFilename}`);

    // 3. Execução e Teste Real do Script Final (src/run.ts)
    console.log(`🧪 [3/4] TESTANDO O SCRIPT FINAL EXECUTÁVEL (src/run.ts)...`);
    const runScriptPath = path.join(localRes.outputDirectory, 'src', 'run.ts');
    if (!fs.existsSync(runScriptPath)) {
      throw new Error(`Script executável src/run.ts não foi gerado em ${localRes.outputDirectory}`);
    }

    const testPayload = {
      testTimestamp: new Date().toISOString(),
      source: 'automated-compiler-test',
      clientKey: 'TEST_KEY_123',
    };

    const cmd = `npx tsx "${runScriptPath}" '${JSON.stringify(testPayload)}'`;
    console.log(`    Executando comando: ${cmd.slice(0, 100)}...`);

    const executionOutput = execSync(cmd, {
      cwd: localRes.outputDirectory,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    console.log(`    ✓ Script executou perfeitamente com código de saída 0!`);
    console.log(`    Saída do script:`);
    const lines = executionOutput.trim().split('\n');
    lines.forEach((l) => console.log(`      | ${l}`));

    // 4. Verificação de integridade dos arquivos estruturais
    console.log(`🔍 [4/4] Validando integridade dos artefatos...`);
    const expectedFiles = [
      'package.json',
      'tsconfig.json',
      'Dockerfile',
      '.env.example',
      'runflux-build.json',
      'src/server.ts',
      'src/run.ts',
    ];
    for (const exp of expectedFiles) {
      const full = path.join(localRes.outputDirectory, exp);
      if (!fs.existsSync(full)) {
        throw new Error(`Arquivo obrigatório ${exp} não encontrado em ${localRes.outputDirectory}`);
      }
    }
    console.log(`    ✓ Todos os ${expectedFiles.length} arquivos estruturais confirmados no disco!\n`);
  }

  console.log('================================================================');
  console.log('🎉 SUCESSO TOTAL: TODOS OS 5 FLUXOS FORAM COMPILADOS E EXECUTADOS COM ÊXITO!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\n❌ ERRO DURANTE A EXECUÇÃO DOS TESTES DE COMPILAÇÃO:');
  console.error(err);
  process.exit(1);
});
