import type { KeyboardEvent } from 'react';

import { TASK_EXAMPLES } from '../demoData';
import { Badge } from './Badge';
import { IconArrowRight, IconSpark } from './icons';
import { Panel } from './Panel';

interface TaskComposerProps {
  task: string;
  onTaskChange: (value: string) => void;
  onGenerate: () => void;
  onClear: () => void;
  hasPlan: boolean;
  planning: boolean;
  plannerMode: 'ai' | 'local';
  plannerHint: string;
}

export function TaskComposer({
  task,
  onTaskChange,
  onGenerate,
  onClear,
  hasPlan,
  planning,
  plannerMode,
  plannerHint,
}: TaskComposerProps) {
  const disabled = task.trim().length === 0 || planning;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!disabled) {
        onGenerate();
      }
    }
  }

  return (
    <Panel
      title="Task brief"
      subtitle="Describe the outcome. Plans are proposals only and never execute."
      badge={
        plannerMode === 'ai' ? (
          <Badge variant="info">AI</Badge>
        ) : (
          <Badge variant="muted">Local</Badge>
        )
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) {
            onGenerate();
          }
        }}
      >
        <label htmlFor="task-brief" className="sr-only">
          Task brief
        </label>
        <div className="rounded-xl border border-line/80 bg-ink/60 transition-colors focus-within:border-mint/35">
          <textarea
            id="task-brief"
            rows={3}
            maxLength={280}
            value={task}
            onChange={(event) => onTaskChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Audit this repository for outdated dependencies and explain the risky ones."
            className="w-full resize-none bg-transparent px-4 py-3 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600 focus:outline-none"
            aria-describedby="task-brief-note"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 px-3 py-2">
            <span className="tnum text-[11px] text-slate-400">{task.length}/280</span>
            <div className="flex items-center gap-2">
              {hasPlan ? (
                <button
                  type="button"
                  onClick={onClear}
                  disabled={planning}
                  className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200 disabled:cursor-not-allowed disabled:text-slate-600"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="submit"
                disabled={disabled}
                aria-busy={planning}
                className="inline-flex items-center gap-2 rounded-lg border border-mint/30 bg-mint/15 px-3 py-1.5 text-[11px] font-semibold text-mint transition-colors hover:bg-mint/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-white/[0.02] disabled:text-slate-600"
              >
                {planning ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-mint animate-pulse-dot" />
                ) : (
                  <IconSpark className="h-3.5 w-3.5" />
                )}
                {planning ? 'Planning…' : 'Generate plan'}
                {planning ? null : <IconArrowRight className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Examples</span>
          {TASK_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onTaskChange(example)}
              className="rounded-full border border-line bg-white/[0.02] px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
            >
              {example}
            </button>
          ))}
        </div>

        <p id="task-brief-note" className="mt-3 text-[11px] leading-relaxed text-slate-500">
          {plannerHint} Ctrl + Enter drafts a plan.
        </p>
      </form>
    </Panel>
  );
}