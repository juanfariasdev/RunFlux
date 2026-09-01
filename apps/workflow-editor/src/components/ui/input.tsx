import { forwardRef, type InputHTMLAttributes } from 'react';

/** Minimal stand-in for shadcn/ui's Input — see button.tsx for why. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...rest }, ref) => (
    <input
      ref={ref}
      className={`h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 disabled:opacity-50 ${className}`}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';
