import { forwardRef, type InputHTMLAttributes } from 'react';

/** Minimal stand-in for shadcn/ui's Checkbox — see button.tsx for why. */
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...rest }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={`h-4 w-4 rounded border-slate-300 text-slate-900 focus:outline-none ${className}`}
      {...rest}
    />
  ),
);
Checkbox.displayName = 'Checkbox';
