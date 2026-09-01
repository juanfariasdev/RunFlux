import type { LabelHTMLAttributes } from 'react';

/** Minimal stand-in for shadcn/ui's Label — see button.tsx for why. */
export function Label({ className = '', ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`text-[10px] font-bold tracking-wide text-slate-600 ${className}`} {...rest} />;
}
