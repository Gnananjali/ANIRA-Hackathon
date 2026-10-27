import type { ReactNode } from 'react';

const styles = {
  demo: 'border-amber/30 bg-amber/10 text-amber-200',
  sample: 'border-sky/30 bg-sky/10 text-sky-200',
  ok: 'border-mint/30 bg-mint/10 text-mint',
  muted: 'border-line bg-white/[0.03] text-slate-400',
  danger: 'border-rose/30 bg-rose/10 text-rose-300',
  info: 'border-sky/25 bg-sky/[0.07] text-sky-200',
} as const;

export type BadgeVariant = keyof typeof styles;

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = 'muted', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex h-[21px] items-center gap-1 rounded-full border px-2 text-[9.5px] font-semibold uppercase leading-none tracking-[0.11em] ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}