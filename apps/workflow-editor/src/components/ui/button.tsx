import type { ButtonHTMLAttributes } from 'react';

/**
 * Minimal stand-in for shadcn/ui's Button (same prop shape: variant, size,
 * ...rest) — shadcn/ui itself isn't npm-installable (its CLI copies source
 * into the repo interactively), so this keeps the app buildable/testable now.
 * Swap for the real `npx shadcn add button` output later; call sites don't change.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm';
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'bg-slate-900 text-white hover:bg-slate-700',
  outline: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
  ghost: 'bg-transparent text-slate-900 hover:bg-slate-100',
  destructive: 'bg-red-600 text-white hover:bg-red-500',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  default: 'h-9 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
};

export function Button({ variant = 'default', size = 'default', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    />
  );
}
