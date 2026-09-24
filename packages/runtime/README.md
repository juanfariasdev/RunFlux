# @runflux/runtime

The workflow runtime shared by the RunFlux editor and every exported backend. The editor runs it
from source; the compiler bundles it, with the plugins a workflow uses, into the backend's
`vendor/runflux-runtime`.

| Entry | Contents | Environment |
| --- | --- | --- |
| `@runflux/runtime` | Node contracts, `WorkflowEngine`, expressions, conditions, fields, `CronExpression`, HTTP client, workflow document | Browser and Node |
| `@runflux/runtime/express` | `ExpressHost`: one endpoint per HTTP trigger | Node |
| `@runflux/runtime/lambda` | `LambdaHost`: function URL requests and scheduled invocations | Node |
| `@runflux/runtime/cron` | `CronHost`: node-cron schedules, loaded only when needed | Node |
| `@runflux/runtime/cli` | `CliHost`: one run from the command line | Node |
| `@runflux/runtime/plugins` | The plugins of an exported backend (empty here; the compiler fills it) | — |
| `@runflux/runtime/testing` | `executeNode()`: runs one node exactly as the engine does | Tests |

## Writing a node

```ts
import { defineNode, NodeOutput, type NodeHandler, type NodeInvocation } from '@runflux/runtime';

export class GreetNode implements NodeHandler<{ name: string }> {
  execute({ parameters }: NodeInvocation<{ name: string }>) {
    return NodeOutput.main(`Hello, ${parameters.name}`);
  }
}

export default defineNode({
  parseParameters: (parameters) => ({ name: parameters.requiredString('name') }),
  createHandler: () => new GreetNode(),
});
```

Test it with the same semantics the engine applies, expressions included:

```ts
import { executeNode } from '@runflux/runtime/testing';
const record = await executeNode(greet, { parameters: { name: '{{ $json.first }}' }, input: { first: 'Ada' } });
// record.output === 'Hello, Ada'; a failure is record.error, never a thrown exception
```

Handlers receive their dependencies in `createHandler(services)`: replace `http`, `logger`, `clock`
or a plugin-specific service in `extensions` instead of mocking modules.

## Lifecycle

`engine.run({ payload, triggerId, signal })` runs the workflow; aborting `signal` stops it.
`engine.dispose()` waits for the runs in progress, then releases what the handlers hold. Whoever
creates an engine disposes it. The hosts (`ExpressHost`, `LambdaHost`, `CronHost`, `CliHost`) depend on
the `WorkflowRunner` port (`workflow` and `run`), which `WorkflowEngine` implements: they only serve
the runner they are given, so a composition root can pass a runner that wraps the engine.

## Rules

- The core entry must stay free of Node.js modules (a test bundles it for the browser).
- Source uses only erasable TypeScript syntax (no parameter properties or enums), because the
  editor type-checks it with `erasableSyntaxOnly`.
- Contracts are structural: plugins and hosts may run against a different copy of this package.
