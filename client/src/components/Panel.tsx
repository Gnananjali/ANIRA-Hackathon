import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({
  title,
  subtitle,
  badge,
  action,
  children,
  className = '',
  bodyClassName = 'px-5 py-4',
}: PanelProps) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-line/80 bg-panel/70 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_24px_50px_-40px_rgba(0,0,0,0.9)] backdrop-blur-sm ${className}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"
      />
      <header className="flex items-start justify-between gap-3 border-b border-line/60 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-[0.01em] text-slate-100">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {badge}
          {action}
        </div>
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}