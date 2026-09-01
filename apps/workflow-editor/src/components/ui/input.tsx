import { forwardRef, type InputHTMLAttributes } from 'react';

/** Minimal stand-in for shadcn/ui's Input — see button.tsx for why. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...rest }, ref) => (
    <input
      ref={ref}
      className={`h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none disabled:opacity-50 ${className}`}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';
