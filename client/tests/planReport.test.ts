import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDemoPlan, buildPlanReport } from '../src/demoData';
import type { InspectionResult, PlanFinding } from '../src/types';

const scan: InspectionResult = {
  root: 'C:\\dev\\anira-sample',
  name: 'anira-sample',
  files: [
    { path: 'package.json', name: 'package.json', extension: 'json', sizeBytes: 100 },
    { path: 'tsconfig.json', name: 'tsconfig.json', extension: 'json', sizeBytes: 80 },
    { path: 'vite.config.ts', name: 'vite.config.ts', extension: 'ts', sizeBytes: 60 },
    { path: 'client/src/App.tsx', name: 'App.tsx', extension: 'tsx', sizeBytes: 300 },
    { path: 'client/src/main.tsx', name: 'main.tsx', extension: 'tsx', sizeBytes: 120 },
    { path: 'server/src/index.ts', name: 'index.ts', extension: 'ts', sizeBytes: 140 },
    { path: 'server/src/app.ts', name: 'app.ts', extension: 'ts', sizeBytes: 260 },
    { path: 'README.md', name: 'README.md', extension: 'md', sizeBytes: 90 },
  ],
  totalFiles: 8,
  totalBytes: 4096,
  truncated: false,
  ignored: ['dist', 'node_modules'],
  stack: [
    { name: 'Node.js', reason: 'package.json' },
    { name: 'TypeScript', reason: 'tsconfig.json' },
    { name: 'React', reason: '2 .tsx/.jsx files' },
    { name: 'Vite', reason: 'vite.config.*' },
  ],
  languages: [
    { name: 'TypeScript', files: 5 },
    { name: 'JSON', files: 2 },
    { name: 'Markdown', files: 1 },
  ],
  scannedAt: '2026-10-26T12:00:00.000Z',
};

const scanWithTests: InspectionResult = {
  ...scan,
  files: [
    ...scan.files,
    {
      path: 'client/tests/app.test.ts',
      name: 'app.test.ts',
      extension: 'ts',
      sizeBytes: 70,
    },
  ],
  totalFiles: 9,
  languages: [
    { name: 'TypeScript', files: 6 },
    { name: 'JSON', files: 2 },
    { name: 'Markdown', files: 1 },
  ],
};

const scannedPaths = new Set(scan.files.map((file) => file.path));
const allFindings = (report: ReturnType<typeof buildPlanReport>): PlanFinding[] => [
  ...report.facts,
  ...report.inferences,
];

describe('finding explanations', () => {
  it('gives every finding a plain-language meaning', () => {
    const report = buildPlanReport('Audit the repository.', scan);

    assert.ok(allFindings(report).length > 0);
    for (const finding of allFindings(report)) {
      assert.ok(finding.meaning.length > 20, `meaning too short: ${finding.label}`);
      assert.notEqual(finding.meaning, finding.detail);
      assert.match(finding.meaning, /[.!]$/);
    }
  });

  it('cites at least one real file for every finding', () => {
    const report = buildPlanReport('Audit the repository.', scan);

    for (const finding of allFindings(report)) {
      assert.ok(
        finding.evidence.length > 0,
        `finding has no evidence: ${finding.label}`,
      );
      for (const path of finding.evidence) {
        assert.ok(scannedPaths.has(path), `evidence not in scan: ${path}`);
      }
    }
  });

  it('explains the primary language with representative files', () => {
    const report = buildPlanReport('Audit the repository.', scan);
    const primary = report.facts.find((finding) =>
      finding.label.startsWith('Primary language:'),
    );

    assert.ok(primary);
    assert.equal(primary.label, 'Primary language: TypeScript');
    assert.match(primary.detail, /5 of 8 listed files/);
    assert.match(primary.meaning, /most of the code/i);
    assert.deepEqual(primary.evidence, ['vite.config.ts', 'client/src/App.tsx']);
  });

  it('keeps facts and assumptions in separate lists', () => {
    const report = buildPlanReport('Audit the repository.', scan);

    assert.ok(report.facts.every((finding) => finding.basis === 'fact'));
    assert.ok(report.inferences.every((finding) => finding.basis === 'inference'));

    const factLabels = new Set(report.facts.map((finding) => finding.label));
    for (const inference of report.inferences) {
      assert.equal(
        factLabels.has(inference.label),
        false,
        `label appears in both lists: ${inference.label}`,
      );
    }
  });

  it('states the manifests that were found', () => {
    const report = buildPlanReport('Audit the repository.', scan);
    const manifests = report.facts.find((finding) => finding.label === 'Manifests on disk');

    assert.ok(manifests);
    assert.deepEqual(manifests.evidence, [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'README.md',
    ]);
    assert.match(manifests.meaning, /contents were not opened/i);
  });

  it('cites the file behind each stack signal', () => {
    const report = buildPlanReport('Audit the repository.', scan);

    const node = report.facts.find((finding) => finding.label === 'Node.js');
    assert.deepEqual(node?.evidence, ['package.json']);
    assert.match(node?.meaning ?? '', /Node\.js package/i);

    const react = report.facts.find((finding) => finding.label === 'React');
    assert.deepEqual(react?.evidence, ['client/src/App.tsx', 'client/src/main.tsx']);
    assert.match(react?.meaning ?? '', /React components/i);
  });

  it('labels derived statements as inferences', () => {
    const report = buildPlanReport('Audit the repository.', scan);
    const labels = report.inferences.map((finding) => finding.label);

    assert.ok(labels.includes('Likely a TypeScript/Node project'));
    assert.ok(labels.includes('Split client/server layout'));
    assert.ok(labels.includes('Likely a browser front-end'));

    const project = report.inferences.find(
      (finding) => finding.label === 'Likely a TypeScript/Node project',
    );
    assert.match(project?.meaning ?? '', /probably/i);
    assert.match(project?.meaning ?? '', /not opened to confirm/i);
  });

  it('reports test files as a fact and says they were not run', () => {
    const report = buildPlanReport('Audit the repository.', scanWithTests);
    const tests = report.facts.find((finding) => finding.label === 'Test files present');

    assert.ok(tests);
    assert.deepEqual(tests.evidence, ['client/tests/app.test.ts']);
    assert.match(tests.meaning, /has not run them/i);
    assert.equal(
      report.limitations.some((limitation) => /No test files/.test(limitation)),
      false,
    );
  });

  it('moves unbacked caveats into limitations', () => {
    const report = buildPlanReport('Audit the repository.', scan);

    assert.ok(report.limitations.some((limitation) => /No test files/.test(limitation)));
    assert.ok(report.limitations.some((limitation) => /node_modules/.test(limitation)));
    assert.ok(report.limitations.some((limitation) => /contents were not read/i.test(limitation)));

    for (const limitation of report.limitations) {
      assert.ok(limitation.length > 10);
    }
  });
});

describe('report safety', () => {
  it('never claims checks ran or passed', () => {
    const report = buildPlanReport('Review the client and run the tests.', scan);
    const text = JSON.stringify(report).toLowerCase();

    assert.match(report.note, /no checks were run/i);
    assert.match(report.note, /no files were modified/i);
    assert.equal(/checks? (passed|succeeded)/.test(text), false);
    assert.equal(/tests? (passed|succeeded)/.test(text), false);
  });

  it('does not invent findings without a scan', () => {
    const report = buildPlanReport('Audit the repository.');

    assert.deepEqual(report.facts, []);
    assert.deepEqual(report.inferences, []);
    assert.equal(report.inspected, null);
    assert.ok(report.limitations.some((limitation) => /No repository scan/.test(limitation)));
  });
});

describe('report steps', () => {
  it('grounds the first step in scanned paths', () => {
    const report = buildPlanReport('Review the client app.', scan);
    const first = report.steps[0];

    assert.equal(first.kind, 'read');
    assert.ok((first.evidence?.length ?? 0) > 0);
    for (const path of first.evidence ?? []) {
      assert.ok(scannedPaths.has(path), `step evidence not in scan: ${path}`);
    }
    assert.match(first.detail, /client\/src\/App\.tsx/);
  });

  it('keeps read-only briefs read-only even with a scan', () => {
    const report = buildPlanReport(
      'List all files and summarize them. Do not edit anything or run any commands.',
      scan,
    );

    assert.ok(report.steps.length > 0);
    assert.ok(report.steps.every((step) => step.kind === 'read'));
    assert.equal(report.steps.some((step) => step.tool === 'checks.run'), false);
  });

  it('adds the checks step only when the brief asks for tests', () => {
    const without = buildPlanReport('Review the client app.', scan);
    assert.equal(without.steps.some((step) => step.kind === 'execute'), false);

    const withTests = buildPlanReport('Review the client app and run the tests.', scan);
    assert.equal(withTests.steps.some((step) => step.kind === 'execute'), true);
  });

  it('keeps destructive writes at high risk', () => {
    const report = buildPlanReport('Delete the temporary build files.', scan);
    const write = report.steps.find((step) => step.kind === 'write');

    assert.ok(write);
    assert.equal(write.risk, 'high');
  });
});

describe('report determinism', () => {
  it('produces identical reports for the same inputs', () => {
    const brief = 'Review the client app and run the tests.';
    assert.deepEqual(buildPlanReport(brief, scan), buildPlanReport(brief, scan));
  });

  it('matches the legacy plan builder when there is no scan', () => {
    const brief = 'Refactor the auth module and run the tests.';
    assert.deepEqual(buildPlanReport(brief).steps, buildDemoPlan(brief));
  });

  it('returns no steps for an empty brief', () => {
    const report = buildPlanReport('   ', scan);
    assert.deepEqual(report.steps, []);
  });
});