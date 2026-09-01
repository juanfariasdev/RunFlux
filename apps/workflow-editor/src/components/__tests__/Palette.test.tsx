import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Palette } from '../Palette';
import type { PluginCatalogAdapter } from '../../adapters/plugin-catalog-adapter';
import type { PluginManifest } from '@runflux/plugin-system/types';

function manifest(id: string, category: PluginManifest['category']): PluginManifest {
  return { id, name: id, category, version: '1.0.0', parameters: [], supportedPlatforms: ['local'] };
}

function fakeCatalog(grouped: Record<string, PluginManifest[]>): PluginCatalogAdapter {
  return {
    listPlugins: async () => grouped,
    checkReference: async () => ({ status: 'ok' }),
  };
}

describe('Palette', () => {
  it('shows a loading state before plugins resolve', () => {
    render(<Palette catalog={fakeCatalog({ trigger: [manifest('trigger-cron', 'trigger')] })} />);
    expect(screen.getByText(/loading plugins/i)).toBeInTheDocument();
  });

  it('renders plugins grouped under their category heading', async () => {
    render(
      <Palette
        catalog={fakeCatalog({
          trigger: [manifest('trigger-cron', 'trigger')],
          action: [manifest('action-http', 'action'), manifest('action-transform', 'action')],
        })}
      />,
    );

    expect(await screen.findByText('trigger-cron')).toBeInTheDocument();
    expect(screen.getByText('action-http')).toBeInTheDocument();
    expect(screen.getByText('action-transform')).toBeInTheDocument();
    expect(screen.getByText('Triggers')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('shows an empty message when no plugins are discovered', async () => {
    render(<Palette catalog={fakeCatalog({})} />);
    expect(await screen.findByText(/no plugins discovered/i)).toBeInTheDocument();
  });

  it('marks each palette item draggable with its plugin id in a data attribute', async () => {
    render(<Palette catalog={fakeCatalog({ trigger: [manifest('trigger-cron', 'trigger')] })} />);
    const item = await screen.findByText('trigger-cron');
    expect(item.closest('[data-plugin-id]')).toHaveAttribute('data-plugin-id', 'trigger-cron');
    expect(item.closest('[draggable]')).toHaveAttribute('draggable', 'true');
  });

  it('uses a transparent native drag image so only the zoom-aware canvas preview is visible', async () => {
    render(<Palette catalog={fakeCatalog({ trigger: [manifest('trigger-cron', 'trigger')] })} />);
    const item = (await screen.findByText('trigger-cron')).closest('[draggable]') as HTMLElement;

    const setData = vi.fn();
    const setDragImage = vi.fn();
    fireEvent.dragStart(item, {
      dataTransfer: { setData, setDragImage, effectAllowed: '' },
      clientX: 15,
      clientY: 8,
    });

    expect(setData).toHaveBeenCalledWith('application/runflux-plugin-id', 'trigger-cron');
    expect(setDragImage).toHaveBeenCalledTimes(1);
    const dragImage = setDragImage.mock.calls[0][0] as HTMLElement;
    expect(dragImage).not.toBe(item);
    expect(dragImage.style.opacity).toBe('0');
    expect(dragImage.style.width).toBe('1px');
  });

  it('publishes the dragged plugin metadata for the canvas preview', async () => {
    render(<Palette catalog={fakeCatalog({ action: [manifest('action-http', 'action')] })} />);
    const item = (await screen.findByText('action-http')).closest('[draggable]') as HTMLElement;
    const onDragStart = vi.fn();
    window.addEventListener('runflux:palette-drag-start', onDragStart);

    fireEvent.dragStart(item, {
      dataTransfer: { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' },
      clientX: 10,
      clientY: 10,
    });

    expect((onDragStart.mock.calls[0][0] as CustomEvent).detail).toEqual({
      id: 'action-http',
      name: 'action-http',
      category: 'action',
      version: '1.0.0',
    });
    window.removeEventListener('runflux:palette-drag-start', onDragStart);
  });
});
