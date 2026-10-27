import {
  IconGrid,
  IconLock,
  IconPlug,
  IconRuns,
  IconSettings,
  IconShield,
} from './icons';

const navigation = [
  { label: 'Overview', icon: IconGrid, active: true },
  { label: 'Runs', icon: IconRuns, active: false },
  { label: 'Policies', icon: IconShield, active: false },
  { label: 'Connectors', icon: IconPlug, active: false },
  { label: 'Settings', icon: IconSettings, active: false },
] as const;

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line/70 bg-ink/60 px-4 py-5 lg:flex">
      <div className="flex items-center gap-3 px-1">
        <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-mint/25 to-sky/10 ring-1 ring-inset ring-mint/30">
          <span className="text-sm font-bold tracking-tight text-mint">A</span>
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-mint animate-pulse-dot" />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-[0.18em] text-slate-100">ANIRA</p>
          <p className="text-[10px] text-slate-500">Desktop assistant</p>
        </div>
      </div>

      <nav className="mt-8 flex-1">
        <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
          Workspace
        </p>
        <ul className="mt-2 space-y-1">
          {navigation.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                disabled={!item.active}
                title={item.active ? 'Current view' : 'Not available in the scaffold milestone'}
                className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                  item.active
                    ? 'bg-white/[0.04] text-slate-100 ring-1 ring-inset ring-line/80'
                    : 'cursor-not-allowed text-slate-500'
                }`}
              >
                {item.active ? (
                  <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-mint" />
                ) : null}
                <item.icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {!item.active ? (
                  <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-500">
                    soon
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="rounded-xl border border-line/80 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2 text-slate-300">
          <IconLock className="h-3.5 w-3.5 text-amber-200" />
          <span className="text-[11px] font-semibold">Guarded execution</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          One allowlisted check and one previewed edit run only after approval. No shell or
          desktop control.
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between px-1 text-[10px] text-slate-500">
        <span>v0.1.0</span>
        <span className="font-mono">scaffold</span>
      </div>
    </aside>
  );
}