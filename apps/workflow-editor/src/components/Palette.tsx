import { useEffect, useState } from 'react';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { PluginCatalogAdapter } from '../adapters/plugin-catalog-adapter';

export interface PaletteProps {
  catalog: PluginCatalogAdapter;
}

const CATEGORY_LABELS: Record<string, string> = {
  trigger: 'Triggers',
  action: 'Actions',
  output: 'Outputs',
  'control-flow': 'Control Flow',
  subworkflow: 'Subworkflow',
};

/** Node palette (RF-01): lists every discovered plugin, grouped by category. */
export function Palette({ catalog }: PaletteProps) {
  const [grouped, setGrouped] = useState<Record<string, PluginManifest[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    catalog.listPlugins().then((result) => {
      if (!cancelled) {
        setGrouped(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  const categories = Object.keys(grouped);

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3" aria-label="Plugin palette">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Palette</h2>
      {loading && <p className="text-sm text-slate-500">Loading plugins…</p>}
      {!loading && categories.length === 0 && (
        <p className="text-sm text-slate-500">No plugins discovered.</p>
      )}
      {categories.map((category) => (
        <div key={category} className="mb-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {CATEGORY_LABELS[category] ?? category}
          </h3>
          <ul className="space-y-1">
            {grouped[category].map((manifest) => (
              <li key={manifest.id}>
                <PaletteItem manifest={manifest} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}

function PaletteItem({ manifest }: { manifest: PluginManifest }) {
  const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData('application/runflux-plugin-id', manifest.id);
    event.dataTransfer.effectAllowed = 'move';

    // Explicitly set the drag preview to the element itself, offset to the
    // exact point the user grabbed it. Some environments don't reliably
    // paint a default ghost image for an element still attached to the live
    // DOM (no snapshot is taken otherwise in those cases) — being explicit
    // here guarantees a visible drag preview everywhere.
    const rect = event.currentTarget.getBoundingClientRect();
    event.dataTransfer.setDragImage(event.currentTarget, event.clientX - rect.left, event.clientY - rect.top);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="cursor-grab rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 shadow-sm hover:border-slate-300 active:cursor-grabbing"
      data-plugin-id={manifest.id}
    >
      {manifest.name}
    </div>
  );
}
