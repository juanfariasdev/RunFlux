# @runflux/app-workflow-editor

Visual drag-and-drop workflow editor (feature `002-workflow-editor`). React 19 + TypeScript, canvas via React Flow (xyflow), state via Zustand, forms via React Hook Form + Zod, consuming `@runflux/plugin-system` (feature `001-plugin-system`).

## How plugin discovery reaches the browser

`PluginRegistry.discover()` (in `@runflux/plugin-system`) reads the filesystem via `node:fs/promises` — it cannot run inside a browser bundle. This app never imports it from browser code; instead, `vite-plugin-plugin-catalog.ts` runs discovery inside Vite's own Node process and serves the result at a fixed URL (`/runflux-plugins.json`) — a dev-server middleware in `npm run dev`, a static build asset in `npm run build`. The browser side (`HttpPluginCatalogAdapter` in `src/adapters/plugin-catalog-adapter.ts`) only ever does `fetch(that URL)`. See `roadmap.md` (D-09 through D-13) for the full story, including why `@runflux/plugin-system` needed a second, pre-bundled `"./node"` entry point (`npm run build:node -w @runflux/plugin-system` — re-run it after changing that package's source).

## Try it (manual walkthrough — mirrors `onboarding.md`)

1. `npm run dev` from this directory (or `npm run dev --workspace=@runflux/app-workflow-editor` from the repo root)
2. The palette on the left lists discovered plugins (currently: `trigger-manual-example` from `001-plugin-system`), grouped by category
3. Drag a plugin from the palette onto the canvas — it appears as a node
4. Connect two nodes by dragging from one node's right handle to another's left handle
5. Try connecting back to an ancestor node — the connection is rejected (DAG enforcement, RF-08)
6. Click a node to open its configuration panel on the right; fields marked `sensitive` in the plugin's manifest render as password inputs
7. Click **Save** with a required field left empty — it succeeds (RN-04)
8. Click **Test** with the same field empty — it's blocked, with the offending node id shown (RF-12)

## Scripts

- `npm run dev` — Vite dev server
- `npm test` — Vitest (unit + component tests, 44 tests across 8 files)
- `npm run typecheck` — `tsc -b`
- `npm run build` — production build (see the known gap above before deploying)

## Architecture notes

- `src/domain/` — canonical workflow model (`types.ts`) and pure logic (`dag.ts`), independent of React Flow
- `src/adapters/` — every external seam: `react-flow-adapter.ts` (canonical ↔ React Flow), `plugin-catalog-adapter.ts` (Plugin System, Node-only today), `validation-runtime-adapter.ts` and `workflow-persistence-adapter.ts` (no-op/in-memory stand-ins for features `validation-runtime` and `workflow-project-management`, not yet built — swap the implementation, not the call sites, once they exist)
- `src/forms/build-zod-schema.ts` — turns a plugin's `parameters` (data) into a Zod schema (D-03)
- `src/store/workflow-store.ts` — Zustand store; `addConnection` is the only place DAG rejection happens
- `src/components/` — Palette, Canvas, NodeConfigPanel, Toolbar, WorkflowNodeView; `ui/` holds minimal Tailwind stand-ins for shadcn/ui primitives (shadcn's CLI copies source interactively, not npm-installable — swap for real `npx shadcn add ...` output later, same prop shapes)
