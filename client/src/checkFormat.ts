export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '0 ms';
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);

  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

export function exitLabel(exitCode: number | null, timedOut: boolean): string {
  if (timedOut) {
    return 'Timed out';
  }

  if (exitCode === null) {
    return 'No exit code';
  }

  return `Exit ${exitCode}`;
}

/** Only a clean, non-interrupted exit 0 counts as a pass. */
export function isCheckPassed(exitCode: number | null, timedOut: boolean): boolean {
  return !timedOut && exitCode === 0;
}