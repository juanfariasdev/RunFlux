# @runflux/app-workflow-editor

Visual drag-and-drop workflow editor (feature `002-workflow-editor`), now with interactive validation (feature `003-validation-runtime`). React 19 + TypeScript, canvas via React Flow (xyflow), state via Zustand, forms via React Hook Form + Zod, consuming `@runflux/plugin-system` (`001-plugin-system`), `@runflux/workflow-model` and `@runflux/validation-runtime` (`003-validation-runtime`).

## How plugin discovery reaches the browser

`PluginRegistry.discover()` (in `@runflux/plugin-system`) reads the filesystem via `node:fs/promises` — it cannot run inside a browser bundle. This app never imports it from browser code; instead, `vite-plugin-plugin-catalog.ts` runs discovery inside Vite's own Node process and serves the result at a fixed URL (`/runflux-plugins.json`) — a dev-server middleware in `npm run dev`, a static build asset in `npm run build`. The browser side (`HttpPluginCatalogAdapter` in `src/adapters/plugin-catalog-adapter.ts`) only ever does `fetch(that URL)`. See `../../_reversa_forward/002-workflow-editor/roadmap.md` (D-09 through D-13) for the full story, including why `@runflux/plugin-system` needed a second, pre-bundled `"./node"` entry point.

## How a plugin's own logic actually runs during "Test" (003-validation-runtime)

Same shape of problem, one layer deeper: a plugin's `execute` function is real JS, not JSON, so it can only run in the Node process that loaded the plugin module — the browser cannot invoke it directly. `vite-plugin-validation-runtime.ts` exposes `POST /runflux-validate` (dev-server only, see the comment in that file for why there is no production/build-time equivalent), running `@runflux/validation-runtime`'s `runWorkflow`/`runNode` for real against a freshly discovered `PluginRegistry`. The browser side (`HttpValidationRuntimeAdapter` in `src/adapters/validation-runtime-adapter.ts`) only ever does `fetch('/runflux-validate')`. Both `@runflux/plugin-system` and `@runflux/validation-runtime` ship a pre-bundled `"./node"` entry point for this (`npm run build:node`, wired into the repo root's `postinstall` via `--workspaces`).

## Try it (manual walkthrough — mirrors `002-workflow-editor/onboarding.md` and `003-validation-runtime/onboarding.md`)

1. `npm run dev` from this directory (or `npm run dev --workspace=@runflux/app-workflow-editor` from the repo root)
2. The palette on the left lists discovered plugins (currently: `trigger-manual-example` from `001-plugin-system`), grouped by category
3. Drag a plugin from the palette onto the canvas — it appears as a node
4. Connect two nodes by dragging from one node's right handle to another's left handle
5. Try connecting back to an ancestor node — the connection is rejected (DAG enforcement, RF-08 of `002`)
6. Click a node to open its configuration panel on the right; fields marked `sensitive` in the plugin's manifest render as password inputs
7. Click **Save** with a required field left empty — it succeeds (RN-04 of `002`)
8. Pick **Sandbox** or **Production** in the toolbar's execution-mode selector, then click **▶ Test** — every node runs for real and shows a small ✓/! badge on the canvas node (RF-01/RF-02/RF-08 of `003`); with a required field left empty, it's blocked instead, with the offending node id shown (RF-12 of `002`)
9. Open a node's panel and click **▶ Test this node** to run just that one node, reusing the last known output of its upstream node (RF-04 of `003`) — try it on a node whose upstream was never tested: it still runs, with a `null` input instead of blocking (RN-06)

## Scripts

- `npm run dev` — Vite dev server
- `npm test` — Vitest (unit + component tests)
- `npm run typecheck` — `tsc -b`
- `npm run build` — production build (see the known gaps above — plugin discovery and validation execution — before deploying)

## Architecture notes

- Canonical workflow model (`WorkflowNode`, `WorkflowConnection`, `WorkflowDefinition`, `wouldCreateCycle`) lives in `@runflux/workflow-model` (extracted from this app's own `src/domain/` during `003-validation-runtime`, D-01) — this app now only holds UI-specific domain logic in `src/domain/` (`connection-compatibility.ts`, `layout.ts`)
- `src/adapters/` — every external seam: `react-flow-adapter.ts` (canonical ↔ React Flow), `plugin-catalog-adapter.ts` (Plugin System catalog, `Http*`/`*.node` split), `validation-runtime-adapter.ts` (`HttpValidationRuntimeAdapter`, real execution via `003-validation-runtime`; `NoopValidationRuntimeAdapter` kept as a lightweight test stand-in), `workflow-persistence-adapter.ts` (in-memory stand-in for `workflow-project-management`, not yet built)
- `src/forms/build-zod-schema.ts` — turns a plugin's `parameters` (data) into a Zod schema (D-03 of `002`)
- `src/store/workflow-store.ts` — Zustand store; `addConnection` is the only place DAG rejection happens; `nodeResults` holds the latest validation result per node for the current session only (never persisted, never part of `workflow`)
- `src/components/` — Palette, Canvas, NodeConfigPanel (now with a "Test this node" action and result display), Toolbar (now with a sandbox/production selector), WorkflowNodeView (now with a ✓/! result badge); `ui/` holds minimal Tailwind stand-ins for shadcn/ui primitives (shadcn's CLI copies source interactively, not npm-installable — swap for real `npx shadcn add ...` output later, same prop shapes)
