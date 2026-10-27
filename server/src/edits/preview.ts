export type LineEnding = 'LF' | 'CRLF' | 'CR' | 'mixed' | 'none';

export interface EditDiff {
  startLine: number;
  startColumn: number;
  removed: string[];
  added: string[];
  contextBefore: string[];
  contextAfter: string[];
  lineEnding: LineEnding;
}

export function detectLineEnding(text: string): LineEnding {
  const hasCrlf = text.includes('\r\n');
  const withoutCrlf = text.replace(/\r\n/g, '');
  const hasLf = withoutCrlf.includes('\n');
  const hasCr = withoutCrlf.includes('\r');

  if (hasCrlf && (hasLf || hasCr)) return 'mixed';
  if (hasCrlf) return 'CRLF';
  if (hasLf) return 'LF';
  if (hasCr) return 'CR';
  return 'none';
}

function lineNumberAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

/**
 * Builds a line preview for one contiguous replacement. The changed line range
 * is derived from the real before/after text, so partial-line and multi-line
 * replacements are both represented accurately.
 */
export function buildEditDiff(
  before: string,
  after: string,
  find: string,
  replace: string,
  index: number,
): EditDiff {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);

  const startLine = lineNumberAt(before, index);
  const lineStart = before.lastIndexOf('\n', index - 1) + 1;
  const startColumn = index - lineStart + 1;

  const endBefore =
    find.length > 0 ? lineNumberAt(before, index + find.length - 1) : startLine;
  const endAfter =
    replace.length > 0 ? lineNumberAt(after, index + replace.length - 1) : startLine;

  const removed = beforeLines.slice(startLine - 1, endBefore);
  const added = afterLines.slice(startLine - 1, endAfter);

  const contextBefore = beforeLines.slice(Math.max(0, startLine - 4), startLine - 1);
  const contextAfter = afterLines.slice(endAfter, endAfter + 3);

  // A final newline produces an empty split element; do not show it as context.
  if (after.endsWith('\n') && contextAfter[contextAfter.length - 1] === '') {
    contextAfter.pop();
  }

  return {
    startLine,
    startColumn,
    removed,
    added,
    contextBefore,
    contextAfter,
    lineEnding: detectLineEnding(before),
  };
}