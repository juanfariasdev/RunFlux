#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import { WorkflowStack, type WorkflowInfrastructure } from '../lib/workflow-stack.js';

const infrastructure = JSON.parse(readFileSync(new URL('../infrastructure.json', import.meta.url), 'utf8')) as WorkflowInfrastructure;

const app = new cdk.App();
new WorkflowStack(app, infrastructure.stackName, infrastructure, { description: infrastructure.description });
