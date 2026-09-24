import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toolbar } from '../Toolbar';
import { useWorkflowStore } from '../../store/workflow-store';
import type { PluginCatalogAdapter } from '../../adapters/plugin-catalog-adapter';
import type { ValidationRuntimeAdapter, ValidationRunResult } from '../../adapters/validation-runtime-adapter';
import type { WorkflowPersistenceAdapter } from '../../adapters/workflow-persistence-adapter';
import type { PluginManifest } from '@runflux/plugin-system/types';

const manifestWithRequiredField: PluginManifest = {
  id: 'action-example',
  name: 'Example Action',
  category: 'action',
  version: '1.0.0',
  parameters: [{ name: 'url', label: 'URL', type: 'string', required: true }],
  supportedPlatforms: ['local'],
};

function fakeCatalog(): PluginCatalogAdapter {
  return {
    listPlugins: async () => ({ action: [manifestWithRequiredField] }),
    checkReference: async () => ({ status: 'ok' }),
  };
}

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: { id: 'wf-1', name: 'My Workflow', nodes: [], connections: [] },
    selectedNodeId: undefined,
    nodeResults: {},
  });
});

describe('Toolbar — Save (RF-07, RN-04)', () => {
  it('saves the workflow even with a required parameter left empty', async () => {
    useWorkflowStore.getState().addNode({
      id: 'n1',
      pluginId: 'action-example',
      pluginVersion: '1.0.0',
      parameters: { url: '' },
      position: { x: 0, y: 0 },
    });

    const save = vi.fn().mockResolvedValue(undefined);
    const persistence: WorkflowPersistenceAdapter = { save, load: vi.fn() };
    const validation: ValidationRuntimeAdapter = { run: vi.fn(), runNode: vi.fn() };

    render(<Toolbar catalog={fakeCatalog()} persistence={persistence} validation={validation} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });
});

describe('Toolbar — Test (RF-06, RF-12, RN-04)', () => {
  it('blocks testing when a required parameter is empty, without calling the validation runtime', async () => {
    useWorkflowStore.getState().addNode({
      id: 'n1',
      pluginId: 'action-example',
      pluginVersion: '1.0.0',
      parameters: { url: '' },
      position: { x: 0, y: 0 },
    });

    const run = vi.fn();
    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await screen.findByText(/fill required fields on node n1/i);
    expect(run).not.toHaveBeenCalled();
  });

  it('calls the validation runtime when all required parameters are filled', async () => {
    useWorkflowStore.getState().addNode({
      id: 'n1',
      pluginId: 'action-example',
      pluginVersion: '1.0.0',
      parameters: { url: 'https://example.com' },
      position: { x: 0, y: 0 },
    });

    const run = vi.fn().mockResolvedValue({ status: 'success', message: 'ok', nodeResults: [] });
    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('ok')).toBeInTheDocument();
  });

  it('stores per-node results from the run in the workflow store (RF-02)', async () => {
    useWorkflowStore.getState().addNode({
      id: 'n1',
      pluginId: 'action-example',
      pluginVersion: '1.0.0',
      parameters: { url: 'https://example.com' },
      position: { x: 0, y: 0 },
    });

    const nodeResult = { nodeId: 'n1', input: null, output: 'ok', error: null, startedAt: 't0', finishedAt: 't1' };
    const run = vi.fn().mockResolvedValue({ status: 'success', nodeResults: [nodeResult] });
    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => expect(useWorkflowStore.getState().nodeResults.n1).toEqual(nodeResult));
  });

  it('defaults to sandbox mode and passes the selected mode to the validation runtime (RF-08)', async () => {
    const run = vi.fn().mockResolvedValue({ status: 'success', nodeResults: [] });
    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );

    fireEvent.change(screen.getByLabelText(/execution mode/i), { target: { value: 'production' } });
    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.anything(), { mode: 'production' }));
  });

  it('clears a previous "ok" status as soon as a new test starts, instead of leaving it showing for the whole run', async () => {
    let resolveSecondRun!: (value: unknown) => void;
    // First click resolves immediately; second click is the one we hold open to inspect mid-run.
    const run = vi.fn()
      .mockResolvedValueOnce({ status: 'success', message: 'ok', nodeResults: [] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondRun = resolve; }));

    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^▶ Test$/ }));
    expect(await screen.findByText('ok')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^▶ Test$/ }));
    await waitFor(() => expect(screen.queryByText('ok')).not.toBeInTheDocument());

    resolveSecondRun({ status: 'success', nodeResults: [] });
  });

  it('clears every node\'s stale "✓" canvas badge as soon as a new run starts, instead of leaving last run\'s results merged in', async () => {
    useWorkflowStore.getState().addNode({
      id: 'n1',
      pluginId: 'action-example',
      pluginVersion: '1.0.0',
      parameters: { url: 'https://example.com' },
      position: { x: 0, y: 0 },
    });

    const nodeResult = { nodeId: 'n1', input: null, output: 'ok', error: null, startedAt: 't0', finishedAt: 't1' };
    let resolveSecondRun!: (value: unknown) => void;
    const run = vi.fn()
      .mockResolvedValueOnce({ status: 'success', nodeResults: [nodeResult] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondRun = resolve; }));

    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^▶ Test$/ }));
    await waitFor(() => expect(useWorkflowStore.getState().nodeResults.n1).toEqual(nodeResult));

    fireEvent.click(screen.getByRole('button', { name: /^▶ Test$/ }));
    await waitFor(() => expect(useWorkflowStore.getState().nodeResults).toEqual({}));

    resolveSecondRun({ status: 'success', nodeResults: [] });
  });

  // A workflow-level run waits on every node, including a Webhook Trigger — which can
  // block for up to 120s on a real HTTP request, same as testing it in isolation. Before
  // this, the button gave no sign anything was happening while that wait was in progress
  // ("the Test button does nothing").
  it('disables the Test button and shows a busy label while the run is in flight', async () => {
    let resolveRun!: (value: ValidationRunResult) => void;
    const run = vi.fn((): Promise<ValidationRunResult> => new Promise((resolve) => { resolveRun = resolve; }));
    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^▶ Test$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /testing/i })).toBeDisabled());

    resolveRun({ status: 'success', nodeResults: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: /^▶ Test$/ })).not.toBeDisabled());
  });

  it('shows a waiting-for-webhook banner (with a way to send a test payload or stop) while the run includes a Webhook Trigger', async () => {
    useWorkflowStore.getState().addNode({
      id: 'wh1',
      pluginId: 'trigger-webhook',
      pluginVersion: '1.0.0',
      parameters: { path: '/orders', httpMethod: 'POST' },
      position: { x: 0, y: 0 },
    });

    let resolveRun!: (value: ValidationRunResult) => void;
    const run = vi.fn((): Promise<ValidationRunResult> => new Promise((resolve) => { resolveRun = resolve; }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^▶ Test$/ }));

    await screen.findByText(/waiting for an incoming webhook on \/orders/i);

    fireEvent.click(screen.getByRole('button', { name: /send test payload now/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/runflux-webhook-test/orders'),
      expect.objectContaining({ method: 'POST' }),
    ));

    resolveRun({ status: 'success', nodeResults: [] });
    await waitFor(() => expect(screen.queryByTestId('toolbar-webhook-waiting-banner')).not.toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  // The engine now runs every Webhook Trigger concurrently and independently — a run
  // with 2 of them only finishes once BOTH have received a request. Before this, the
  // banner only ever showed (and could send a payload to) `webhookNodes[0]`, so there
  // was no way through the UI to satisfy the second one — the run looked stuck forever.
  it('gives each Webhook Trigger its own row and its own "send test payload" button when a run has more than one', async () => {
    useWorkflowStore.getState().addNode({
      id: 'wh1',
      pluginId: 'trigger-webhook',
      pluginVersion: '1.0.0',
      parameters: { path: '/hook-a', httpMethod: 'POST' },
      position: { x: 0, y: 0 },
    });
    useWorkflowStore.getState().addNode({
      id: 'wh2',
      pluginId: 'trigger-webhook',
      pluginVersion: '1.0.0',
      parameters: { path: '/hook-b', httpMethod: 'POST' },
      position: { x: 0, y: 0 },
    });

    let resolveRun!: (value: ValidationRunResult) => void;
    const run = vi.fn((): Promise<ValidationRunResult> => new Promise((resolve) => { resolveRun = resolve; }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^▶ Test$/ }));

    await screen.findByText(/waiting for an incoming webhook on \/hook-a/i);
    await screen.findByText(/waiting for an incoming webhook on \/hook-b/i);

    const sendButtons = screen.getAllByRole('button', { name: /send test payload now/i });
    expect(sendButtons).toHaveLength(2);

    fireEvent.click(sendButtons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/runflux-webhook-test/hook-a'),
      expect.anything(),
    ));

    fireEvent.click(sendButtons[1]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/runflux-webhook-test/hook-b'),
      expect.anything(),
    ));

    resolveRun({ status: 'success', nodeResults: [] });
    await waitFor(() => expect(screen.queryByTestId('toolbar-webhook-waiting-banner')).not.toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  // Canvas.tsx renders the same spinning badge for any node id in `testingNodeIds` —
  // a whole-workflow run needs to report its Webhook Trigger(s) through this callback
  // so the canvas actually shows them as waiting, not just the toolbar banner.
  it('reports the Webhook Trigger node id via onTestingNodesChange for the duration of the run, so its canvas badge lights up too', async () => {
    useWorkflowStore.getState().addNode({
      id: 'wh1',
      pluginId: 'trigger-webhook',
      pluginVersion: '1.0.0',
      parameters: { path: '/orders', httpMethod: 'POST' },
      position: { x: 0, y: 0 },
    });

    let resolveRun!: (value: ValidationRunResult) => void;
    const run = vi.fn((): Promise<ValidationRunResult> => new Promise((resolve) => { resolveRun = resolve; }));
    const onTestingNodesChange = vi.fn();

    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
        onTestingNodesChange={onTestingNodesChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^▶ Test$/ }));

    await waitFor(() => expect(onTestingNodesChange).toHaveBeenCalledWith(['wh1']));

    resolveRun({ status: 'success', nodeResults: [] });
    await waitFor(() => expect(onTestingNodesChange).toHaveBeenLastCalledWith([]));
  });

  it('shows an error status and re-enables the Test button when the run rejects (e.g. a cancelled webhook wait)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('Webhook listening cancelled by user'));
    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run, runNode: vi.fn() }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^▶ Test$/ }));

    expect(await screen.findByText(/webhook listening cancelled by user/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^▶ Test$/ })).not.toBeDisabled();
  });
});

describe("Toolbar — Compiler Button", () => {
  it("renders the compile button in English and opens the compiler modal", () => {
    render(
      <Toolbar
        catalog={fakeCatalog()}
        persistence={{ save: vi.fn(), load: vi.fn() }}
        validation={{ run: vi.fn(), runNode: vi.fn() }}
      />
    );
    const compileBtn = screen.getByTestId("open-compiler-modal-btn");
    expect(compileBtn).toHaveTextContent("Compile");
    fireEvent.click(compileBtn);
    expect(screen.getByText(/Compile Backend/i)).toBeInTheDocument();
  });
});
