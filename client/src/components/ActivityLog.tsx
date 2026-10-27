import type { ActivityEntry, ActivityKind } from '../types';
import { Badge } from './Badge';
import { Panel } from './Panel';

const dotStyles: Record<ActivityKind, string> = {
  system: 'bg-mint',
  user: 'bg-sky',
};

export function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  return (
    <Panel
      title="Activity"
      subtitle="Local session log. Not persisted."
      badge={<Badge variant="muted">{entries.length}</Badge>}
      bodyClassName="px-5 py-4"
    >
      <ul className="max-h-[260px] space-y-3 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start gap-2.5">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotStyles[entry.kind]}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <time className="tnum font-mono text-[10px] text-slate-500">
                  {new Date(entry.at).toLocaleTimeString([], { hour12: false })}
                </time>
                <Badge variant="ok">Live</Badge>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{entry.message}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-line/60 pt-3 text-[10px] leading-relaxed text-slate-500">
        Every entry is a real UI event from this session. The log is not persisted.
      </p>
    </Panel>
  );
}