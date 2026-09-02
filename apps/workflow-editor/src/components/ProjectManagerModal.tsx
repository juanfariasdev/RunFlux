import { useState, useRef } from 'react';
import { useProject } from '../context/ProjectContext';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface ProjectManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectManagerModal({ isOpen, onClose }: ProjectManagerModalProps) {
  const {
    projects,
    archivedProjects,
    currentProject,
    openProject,
    createNewProject,
    archiveProject,
    restoreProject,
    deleteProjectPermanently,
    exportProject,
    importProjectFile,
    isLoading,
  } = useProject();

  const [activeTab, setActiveTab] = useState<'active' | 'trash'>('active');
  const [search, setSearch] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;

    try {
      await createNewProject(name);
      setNewProjectName('');
      setIsCreating(false);
      showToast(`Projeto '${name}' criado com sucesso!`);
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Erro ao criar projeto', 'error');
    }
  };

  const handleOpen = async (id: string) => {
    try {
      await openProject(id);
      showToast('Projeto carregado no canvas');
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Erro ao abrir projeto', 'error');
    }
  };

  const handleArchive = async (id: string, name: string) => {
    try {
      await archiveProject(id);
      showToast(`Projeto '${name}' movido para a Lixeira`);
    } catch (err: any) {
      showToast(err?.message || 'Erro ao arquivar projeto', 'error');
    }
  };

  const handleRestore = async (id: string, name: string) => {
    try {
      await restoreProject(id);
      showToast(`Projeto '${name}' restaurado para a lista ativa`);
    } catch (err: any) {
      showToast(err?.message || 'Erro ao restaurar projeto', 'error');
    }
  };

  const handleDeletePermanent = async (id: string) => {
    try {
      await deleteProjectPermanently(id);
      setDeleteConfirmId(null);
      showToast('Projeto excluído permanentemente do banco de dados');
    } catch (err: any) {
      showToast(err?.message || 'Erro ao excluir projeto', 'error');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const imported = await importProjectFile(file);
      showToast(`Projeto '${imported.name}' importado com sucesso!`);
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Arquivo inválido', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const filteredActive = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredTrash = archivedProjects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-modal-title"
    >
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 id="project-modal-title" className="text-lg font-bold text-slate-800">
              Gerenciador de Projetos
            </h2>
            <p className="text-xs text-slate-500">
              Crie, reabra, arquive ou exporte seus fluxos de trabalho
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {/* Toast Notification */}
        {toastMessage && (
          <div
            className={`mx-6 mt-3 rounded-lg px-4 py-2.5 text-xs font-medium ${
              toastMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}
          >
            {toastMessage.text}
          </div>
        )}

        {/* Controls: Search & Tabs */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-3 bg-slate-50/60">
          <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 text-xs font-medium">
            <button
              onClick={() => setActiveTab('active')}
              className={`rounded-md px-3 py-1.5 transition-all ${
                activeTab === 'active'
                  ? 'bg-white text-indigo-700 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ativos ({projects.length})
            </button>
            <button
              onClick={() => setActiveTab('trash')}
              className={`rounded-md px-3 py-1.5 transition-all ${
                activeTab === 'trash'
                  ? 'bg-white text-rose-700 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lixeira ({archivedProjects.length})
            </button>
          </div>

          <div className="flex flex-1 max-w-xs items-center">
            <Input
              placeholder="Buscar por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs bg-white"
            />
          </div>

          {activeTab === 'active' && (
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".json,.runflux.json"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 text-xs font-medium"
              >
                Importar (.json)
              </Button>
              <Button
                size="sm"
                onClick={() => setIsCreating(true)}
                className="h-8 text-xs font-medium bg-indigo-600 hover:bg-indigo-700"
              >
                + Novo Projeto
              </Button>
            </div>
          )}
        </div>

        {/* Inline Create Form */}
        {isCreating && (
          <form
            onSubmit={handleCreate}
            className="flex items-center gap-2 border-b border-indigo-100 bg-indigo-50/50 px-6 py-3"
          >
            <Input
              autoFocus
              placeholder="Nome do novo projeto..."
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              className="h-8 text-xs flex-1 bg-white"
            />
            <Button size="sm" type="submit" className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700">
              Criar
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                setIsCreating(false);
                setNewProjectName('');
              }}
              className="h-8 text-xs"
            >
              Cancelar
            </Button>
          </form>
        )}

        {/* Project List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === 'active' ? (
            filteredActive.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-500 text-xl font-bold">
                  📂
                </div>
                <h3 className="mt-3 text-sm font-semibold text-slate-700">
                  Nenhum projeto ativo encontrado
                </h3>
                <p className="mt-1 text-xs text-slate-400 max-w-xs">
                  {search
                    ? 'Nenhum resultado para a busca. Tente outros termos.'
                    : 'Crie seu primeiro projeto para começar a desenhar fluxos persistidos.'}
                </p>
                {!search && (
                  <Button
                    size="sm"
                    onClick={() => setIsCreating(true)}
                    className="mt-4 text-xs bg-indigo-600 hover:bg-indigo-700"
                  >
                    + Criar Primeiro Projeto
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredActive.map((p) => {
                  const isCurrent = currentProject?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`group flex items-center justify-between rounded-xl border p-3.5 transition-all ${
                        isCurrent
                          ? 'border-indigo-300 bg-indigo-50/40 shadow-sm'
                          : 'border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold text-sm text-slate-800">
                            {p.name}
                          </span>
                          {isCurrent && (
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                              Aberto agora
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                          <span>{p.nodeCount} nós</span>
                          <span>•</span>
                          <span>
                            Atualizado em{' '}
                            {new Date(p.updatedAt).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 opacity-90 group-hover:opacity-100">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpen(p.id)}
                          className="h-8 text-xs font-medium"
                          disabled={isLoading}
                        >
                          Abrir
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => exportProject(p.id)}
                          className="h-8 text-xs font-medium"
                          title="Exportar para arquivo .runflux.json"
                        >
                          Exportar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleArchive(p.id, p.name)}
                          className="h-8 text-xs text-slate-600 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50"
                          title="Mover para a lixeira"
                        >
                          Arquivar
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : filteredTrash.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 text-xl">
                🗑️
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-700">
                A lixeira está vazia
              </h3>
              <p className="mt-1 text-xs text-slate-400 max-w-xs">
                Projetos que você arquivar da lista principal aparecerão aqui para restauração ou exclusão definitiva.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTrash.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/20 p-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <span className="truncate font-semibold text-sm text-slate-800">
                      {p.name}
                    </span>
                    <div className="mt-1 text-xs text-slate-400">
                      Arquivado em{' '}
                      {p.archivedAt
                        ? new Date(p.archivedAt).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-'}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestore(p.id, p.name)}
                      className="h-8 text-xs font-medium text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300"
                    >
                      Restaurar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteConfirmId(p.id)}
                      className="h-8 text-xs font-medium text-rose-700 hover:bg-rose-50 hover:border-rose-300"
                    >
                      Excluir Definitivamente
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 bg-slate-50/50 text-xs text-slate-400">
          <span>RunFlux Project Storage (Prisma + SQLite)</span>
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
            Fechar
          </Button>
        </div>
      </div>

      {/* T024: Modal de Confirmação de Exclusão Definitiva */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-rose-200 bg-white p-5 shadow-2xl">
            <h4 className="text-sm font-bold text-rose-600">
              Excluir Definitivamente?
            </h4>
            <p className="mt-2 text-xs text-slate-600 leading-relaxed">
              Esta ação é <strong>irreversível</strong>. O projeto e todo o seu histórico de versões de workflow serão permanentemente apagados do banco de dados.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirmId(null)}
                className="h-8 text-xs"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={() => handleDeletePermanent(deleteConfirmId)}
                className="h-8 text-xs bg-rose-600 hover:bg-rose-700 text-white"
              >
                Sim, Excluir
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
