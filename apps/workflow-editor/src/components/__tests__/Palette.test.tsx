import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
