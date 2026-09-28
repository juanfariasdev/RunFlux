import { useEffect, useRef, useState, type FormEvent } from 'react';
import { setTokenPrompt, type TokenPrompt } from '../adapters/authorized-fetch';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface PendingPrompt {
  reason: Parameters<TokenPrompt>[0];
  promise: Promise<string | null>;
  resolve: (token: string | null) => void;
}

/**
 * Asks for the platform token when the project server or the editor's dev server answers 401
 * (RN-14). While mounted, it is the prompt of `authorizedFetch`; requests refused at the same time
 * share one question.
 */
export function AccessTokenDialog() {
  const pending = useRef<PendingPrompt | null>(null);
  const [reason, setReason] = useState<PendingPrompt['reason'] | null>(null);
  const [token, setToken] = useState('');

  useEffect(() => {
    setTokenPrompt((why) => {
      if (pending.current) return pending.current.promise;
      let resolve!: (token: string | null) => void;
      const promise = new Promise<string | null>((settle) => { resolve = settle; });
      pending.current = { reason: why, promise, resolve };
      setToken('');
      setReason(why);
      return promise;
    });
    return () => setTokenPrompt(undefined);
  }, []);

  if (!reason) return null;

  const finish = (value: string | null) => {
    const current = pending.current;
    pending.current = null;
    setReason(null);
    setToken('');
    current?.resolve(value);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim()) finish(token.trim());
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-token-title"
    >
      <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2 id="access-token-title" className="text-lg font-semibold text-slate-100">Token de acesso</h2>
        <p className="mt-1 text-xs text-slate-400">
          {reason === 'rejected'
            ? 'O servidor recusou o token. Digite o valor de RUNFLUX_API_TOKEN de novo.'
            : 'O servidor de projetos exige autenticação. Digite o valor de RUNFLUX_API_TOKEN.'}
        </p>
        <label htmlFor="access-token-input" className="mt-4 block text-[11px] font-medium text-slate-400">
          RUNFLUX_API_TOKEN
        </label>
        <Input
          id="access-token-input"
          type="password"
          autoFocus
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="mt-1 !h-8 bg-slate-900 border-slate-700 text-xs font-mono text-slate-100"
        />
        <p className="mt-2 text-[11px] text-slate-500">O token fica guardado só nesta sessão do navegador.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => finish(null)} className="!h-8 text-xs border-slate-700 text-slate-300 hover:bg-slate-800">
            Cancelar
          </Button>
          <Button type="submit" disabled={!token.trim()} className="!h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium">
            Entrar
          </Button>
        </div>
      </form>
    </div>
  );
}
