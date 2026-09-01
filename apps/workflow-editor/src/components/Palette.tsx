import { useEffect, useMemo, useState } from 'react';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { PluginCatalogAdapter } from '../adapters/plugin-catalog-adapter';

export interface PaletteProps { catalog: PluginCatalogAdapter; }

const CATEGORY_LABELS: Record<string, string> = {
  trigger: 'Triggers', action: 'Actions', output: 'Outputs', 'control-flow': 'Control Flow', subworkflow: 'Subworkflows',
};

export function Palette({ catalog }: PaletteProps) {
  const [grouped, setGrouped] = useState<Record<string, PluginManifest[]>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    catalog.listPlugins().then((result) => {
      if (!cancelled) { setGrouped(result); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [catalog]);

  const visibleGroups = useMemo(() => Object.entries(grouped)
    .map(([category, manifests]) => [category, manifests.filter((manifest) => `${manifest.name} ${manifest.id}`.toLowerCase().includes(query.toLowerCase()))] as const)
    .filter(([, manifests]) => manifests.length > 0), [grouped, query]);
  const total = Object.values(grouped).flat().length;

  return (
    <aside className="flex w-[270px] shrink-0 flex-col border-r border-slate-200 bg-white max-[1120px]:w-[230px]" aria-label="Plugin palette">
      <header className="flex items-end justify-between px-[18px] pb-[13px] pt-[22px]">
        <div><span className="mb-0.5 block text-[9px] font-extrabold tracking-[.16em] text-indigo-500">RUNFLUX</span><h2 className="m-0 text-lg font-bold tracking-tight">Library</h2></div>
        <span className="grid h-[22px] min-w-[26px] place-items-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500">{total}</span>
      </header>
      <label className="mx-3.5 flex h-[38px] items-center gap-2 rounded-[10px] border border-slate-200 bg-slate-50 px-3 transition focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-50">
        <svg className="w-[15px] text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input className="min-w-0 flex-1 border-0 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes…" aria-label="Search nodes" />
      </label>
      <p className="mx-[17px] mb-[15px] mt-2.5 text-[10px] text-slate-400">Drag an item onto the canvas</p>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 [scrollbar-color:#cbd5e1_transparent] [scrollbar-width:thin]">
        {loading && <div className="grid gap-2"><span className="sr-only">Loading plugins…</span>{[0, 1, 2].map((item) => <span key={item} className="h-[58px] animate-pulse rounded-xl bg-slate-100" />)}</div>}
        {!loading && total === 0 && <p className="px-2 py-5 text-center text-[11px] text-slate-400">No plugins discovered.</p>}
        {!loading && total > 0 && visibleGroups.length === 0 && <p className="px-2 py-5 text-center text-[11px] text-slate-400">No nodes found.</p>}
        {visibleGroups.map(([category, manifests]) => (
          <section key={category} className="mb-[18px]">
            <h3 className="mx-1 mb-2 flex items-center justify-between text-[9px] font-extrabold uppercase tracking-[.12em] text-slate-500"><span>{CATEGORY_LABELS[category] ?? category}</span><small className="text-[9px] text-slate-400">{manifests.length}</small></h3>
            <ul className="m-0 grid list-none gap-1.5 p-0">{manifests.map((manifest) => <li key={manifest.id}><PaletteItem manifest={manifest} /></li>)}</ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

function PaletteItem({ manifest }: { manifest: PluginManifest }) {
  const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData('application/runflux-plugin-id', manifest.id);
    event.dataTransfer.setData('text/plain', manifest.id);
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({ id: manifest.id, name: manifest.name, category: manifest.category, version: manifest.version }),
    );
    event.dataTransfer.effectAllowed = 'copyMove';
    try {
      const bounds = event.currentTarget.getBoundingClientRect();
      event.dataTransfer.setDragImage(event.currentTarget, event.clientX - bounds.left, event.clientY - bounds.top);
    } catch {
      // ignore
    }
    const target = event.currentTarget;
    setTimeout(() => {
      target?.classList.add('opacity-40', 'border-dashed');
    }, 0);
    window.dispatchEvent(new CustomEvent('runflux:palette-drag-start', {
      detail: { id: manifest.id, name: manifest.name, category: manifest.category, version: manifest.version },
    }));
  };

  const onDragEnd = (event: React.DragEvent<HTMLDivElement>) => {
    event.currentTarget.classList.remove('opacity-40', 'border-dashed');
    window.dispatchEvent(new Event('runflux:palette-drag-end'));
  };

  const onAddClick = () => {
    window.dispatchEvent(new CustomEvent('runflux:palette-add-plugin', {
      detail: { id: manifest.id, name: manifest.name, category: manifest.category, version: manifest.version },
    }));
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={onAddClick}
      className="group flex min-h-[58px] cursor-grab select-none items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm transition hover:-translate-y-px hover:border-indigo-200 hover:shadow-lg active:cursor-grabbing"
      data-plugin-id={manifest.id}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${categoryClasses(manifest.category)}`}><PluginIcon category={manifest.category} /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <strong className="truncate text-[11px] text-slate-800">{manifest.name}</strong>
        {manifest.id !== manifest.name && <small className="truncate text-[9px] text-slate-400">{manifest.id}</small>}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddClick();
        }}
        className="opacity-0 group-hover:opacity-100 grid h-6 w-6 place-items-center rounded-lg bg-indigo-50 text-xs font-bold text-indigo-600 transition hover:bg-indigo-600 hover:text-white"
        title="Click to add to the workflow"
        aria-label={`Add ${manifest.name} to the workflow`}
      >
        ＋
      </button>
      <span className="text-[15px] text-slate-300 transition group-hover:hidden" aria-hidden="true">⠿</span>
    </div>
  );
}

function categoryClasses(category: PluginManifest['category']) {
  if (category === 'trigger') return 'bg-emerald-50 text-emerald-600';
  if (category === 'output') return 'bg-orange-50 text-orange-600';
  if (category === 'control-flow') return 'bg-violet-50 text-violet-600';
  return 'bg-indigo-50 text-indigo-600';
}

function PluginIcon({ category }: { category: PluginManifest['category'] }) {
  if (category === 'trigger') return <svg className="h-[18px] w-[18px] fill-none stroke-current stroke-[1.8]" viewBox="0 0 24 24"><path d="M13 2 4.5 13H11l-1 9 8.5-12H12l1-8Z" /></svg>;
  if (category === 'output') return <svg className="h-[18px] w-[18px] fill-none stroke-current stroke-[1.8]" viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>;
  return <svg className="h-[18px] w-[18px] fill-none stroke-current stroke-[1.8]" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /><path d="M10 6h3a4 4 0 0 1 4 4v4" /></svg>;
}
