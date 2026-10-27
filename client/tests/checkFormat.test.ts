import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { exitLabel, formatDuration, isCheckPassed } from '../src/checkFormat';

describe('check result formatting', () => {
  it('formats durations', () => {
    assert.equal(formatDuration(0), '0 ms');
    assert.equal(formatDuration(950), '950 ms');
    assert.equal(formatDuration(3120), '3.1 s');
    assert.equal(formatDuration(61_000), '1 min 1 s');
    assert.equal(formatDuration(Number.NaN), '0 ms');
  });

  it('labels exit codes', () => {
    assert.equal(exitLabel(0, false), 'Exit 0');
    assert.equal(exitLabel(3, false), 'Exit 3');
    assert.equal(exitLabel(null, false), 'No exit code');
    assert.equal(exitLabel(null, true), 'Timed out');
    assert.equal(exitLabel(1, true), 'Timed out');
  });

  it('only treats a clean exit 0 as passed', () => {
    assert.equal(isCheckPassed(0, false), true);
    assert.equal(isCheckPassed(1, false), false);
    assert.equal(isCheckPassed(3, false), false);
    assert.equal(isCheckPassed(null, false), false);
    assert.equal(isCheckPassed(0, true), false);
    assert.equal(isCheckPassed(null, true), false);
  });
});