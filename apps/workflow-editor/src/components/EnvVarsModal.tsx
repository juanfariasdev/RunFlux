import { useState, useEffect } from 'react';
import { useProject } from '../context/ProjectContext';
import type { ProjectEnvVar } from '../adapters/project-api-adapter';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface EnvVarsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EnvVarsModal({ isOpen, onClose }: EnvVarsModalProps) {
  const { currentProject, envVars, saveEnvVars } = useProject();
  const [localVars, setLocalVars] = useState<ProjectEnvVar[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalVars(envVars ? [...envVars] : []);
      setError(null);
      setSuccess(null);
      setNewKey('');
      setNewValue('');
      setNewDescription('');
    }
  }, [isOpen, envVars]);

  if (!isOpen) return null;

  const validateKey = (key: string): boolean => {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
  };

  const handleAdd = () => {
    const trimmedKey = newKey.trim();
    if (!trimmedKey) {
      setError('Nome da variável não pode ser vazio');
      return;
    }
    if (!validateKey(trimmedKey)) {
      setError('Nome da variável deve conter apenas letras, números e sublinhados (ex: API_KEY)');
      return;
    }
    if (localVars.some((v) => v.key.toUpperCase() === trimmedKey.toUpperCase())) {
      setError(`Variável '${trimmedKey}' já existe nesta lista`);
      return;
    }

    setLocalVars([
      ...localVars,
      {
        key: trimmedKey,
        value: newValue,
        description: newDescription.trim() || undefined,
      },
    ]);
    setNewKey('');
    setNewValue('');
    setNewDescription('');
    setError(null);
  };

  const handleRemove = (index: number) => {
    setLocalVars(localVars.filter((_, i) => i !== index));
  };

  const handleUpdate = (index: number, field: keyof ProjectEnvVar, val: string) => {
    setLocalVars(
      localVars.map((item, i) => {
        if (i !== index) return item;
        return { ...item, [field]: val };
      })
    );
  };

  const handleSave = async () => {
    // Validate all keys
    for (const v of localVars) {
      if (!v.key.trim() || !validateKey(v.key.trim())) {
        setError(`Variável '${v.key}' possui identificador inválido.`);
        return;
      }
    }

    setIsSaving(true);
    setError(null);
    try {
      await saveEnvVars(localVars);
      setSuccess('Variáveis de ambiente salvas com sucesso!');
      setTimeout(() => {
        setSuccess(null);
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar variáveis de ambiente');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="env-vars-modal-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 id="env-vars-modal-title" className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20 text-emerald-400 font-mono text-xs font-bold">
                $
              </span>
              Environment Variables
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Projeto: <span className="font-medium text-slate-200">{currentProject?.name || 'Untitled'}</span> • Acesso global via <code className="text-emerald-400">{'{{ $env.KEY }}'}</code>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-400">
              {success}
            </div>
          )}

          {/* Add Form */}
          <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3.5">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
              Adicionar Nova Variável
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Nome (Chave)</label>
                <Input
                  placeholder="EX: STRIPE_API_KEY"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                  className="!h-8 bg-slate-900 border-slate-700 text-xs font-mono text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Valor de Teste / Dev</label>
                <Input
                  placeholder="sk_test_..."
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="!h-8 bg-slate-900 border-slate-700 text-xs font-mono text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Descrição</label>
                <Input
                  placeholder="Finalidade da chave"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="!h-8 bg-slate-900 border-slate-700 text-xs text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                variant="default"
                onClick={handleAdd}
                className="!h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
              >
                + Adicionar Variável
              </Button>
            </div>
          </div>

          {/* Variables Table */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Variáveis Cadastradas ({localVars.length})
            </h3>
            {localVars.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-xs text-slate-500">
                Nenhuma variável de ambiente cadastrada neste projeto.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-950/50">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/80 text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Chave</th>
                      <th className="py-2 px-3 font-semibold">Valor de Teste</th>
                      <th className="py-2 px-3 font-semibold">Descrição</th>
                      <th className="py-2 px-2 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {localVars.map((v, index) => (
                      <tr key={index} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2 px-3 font-mono font-medium text-emerald-400">
                          <input
                            type="text"
                            value={v.key}
                            onChange={(e) => handleUpdate(index, 'key', e.target.value.toUpperCase())}
                            className="w-full bg-transparent border-0 border-b border-transparent focus:border-emerald-500 focus:outline-none text-xs font-mono"
                          />
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-200">
                          <input
                            type="text"
                            value={v.value}
                            placeholder="vazio"
                            onChange={(e) => handleUpdate(index, 'value', e.target.value)}
                            className="w-full bg-transparent border-0 border-b border-transparent focus:border-emerald-500 focus:outline-none text-xs font-mono"
                          />
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          <input
                            type="text"
                            value={v.description || ''}
                            placeholder="opcional"
                            onChange={(e) => handleUpdate(index, 'description', e.target.value)}
                            className="w-full bg-transparent border-0 border-b border-transparent focus:border-emerald-500 focus:outline-none text-xs"
                          />
                        </td>
                        <td className="py-2 px-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemove(index)}
                            title="Remover variável"
                            className="rounded p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-3.5 bg-slate-950/50 rounded-b-xl">
          <p className="text-[11px] text-slate-500">
            Valores são gerados no <code className="text-slate-400">.env.example</code> ao compilar.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="!h-8 text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleSave}
              disabled={isSaving}
              className="!h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
            >
              {isSaving ? 'Salvando...' : 'Salvar Variáveis'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
