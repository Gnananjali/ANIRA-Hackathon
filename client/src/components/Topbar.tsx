import type { HealthState } from '../types';
import { Badge } from './Badge';
import { StatusPill } from './StatusPill';

export function Topbar({ health }: { health: HealthState }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line/60 bg-void/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-mint/25 to-sky/10 ring-1 ring-inset ring-mint/30">
              <span className="text-[11px] font-bold text-mint">A</span>
            </div>
            <span className="text-xs font-semibold tracking-[0.18em] text-slate-100">ANIRA</span>
          </div>
          <div className="hidden items-center gap-2 text-[11.5px] text-slate-500 sm:flex">
            <span>Workspace</span>
            <span className="text-slate-600">/</span>
            <span className="font-medium text-slate-300">Overview</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Badge variant="demo">Demo data</Badge>
          <StatusPill health={health} />
          <div className="grid h-8 w-8 place-items-center rounded-full border border-line bg-white/[0.03] text-[10px] font-semibold tracking-wide text-slate-300">
            AN
          </div>
        </div>
      </div>
    </header>
  );
}