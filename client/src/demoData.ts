import type {
  InspectionResult,
  PlanConstraints,
  PlanFinding,
  PlanReport,
  PlanStep,
} from './types';

export const TASK_EXAMPLES = [
  'List the files in src and summarize them',
  'Audit dependencies for risky versions',
  'Refactor the auth module and run the tests',
];
/**
 * Deterministic keyword signals.
 *
 * These are plain regular expressions over the brief text: no model call,
 * no filesystem access, and no execution. They exist so the demo plan never
 * proposes an action the user explicitly ruled out.
 */
const READ_ONLY_PHRASE = /\bread[\s-]?only\b/i;

const NEGATION = /\b(?:no|not|never|don'?t|do not|does not|without|forbid|forbidden|avoid)\b/i;

const EDIT_ACTION =
  /\b(?:edit|edits|editing|modify|modifies|modifying|change|changes|changing|write|writes|writing|patch|patches|patching|refactor|refactoring|update|updates|updating|touch|touches|touching|delete|deletes|deleting|remove|removes|removing|drop|drops|rename|renames|migrate|migrates|create|creates|overwrite|overwrites|wipe|wipes|destroy)\b/i;

const EXECUTE_ACTION =
  /\b(?:run|runs|running|execute|executes|executing|execution|command|commands|shell|script|scripts|subprocess|terminal)\b/i;

const WRITE_INTENT =
  /\b(?:edit|edits|modify|modifies|change|changes|write|writes|patch|refactor|refactors|update|updates|fix|fixes|implement|implements|add|adds|remove|removes|rename|renames|migrate|migrates|delete|deletes|create|creates|destroy|destroys|drop|drops|wipe|wipes|overwrite|overwrites)\b/i;

/**
 * An explicit request for tests or checks.
 *
 * The plan only adds a "Run the declared checks" step when the brief asks for
 * tests or checks by name. A change request on its own never implies it, and
 * a generic "run something" is not a request for checks.
 */
const CHECK_INTENT =
  /\b(?:test|tests|testing|check|checks|checking|typecheck|type-check|typechecks|lint|linting|verify|verifying|unit[- ]test|spec|ci)\b/i;

const DESTRUCTIVE_INTENT =
  /\b(?:delete|deletes|destroy|drop|drops|wipe|wipes|overwrite|overwrites|remove|removes)\b/i;

export function derivePlanConstraints(brief: string): PlanConstraints {
  const text = typeof brief === 'string' ? brief : '';
  const readOnly = READ_ONLY_PHRASE.test(text);

  // Negation applies within a clause only. Splitting first stops "do not edit
  // any files, but run the tests" from also banning the test run.
  let forbidEdits = readOnly;
  let forbidExecution = readOnly;

  for (const clause of splitClauses(text)) {
    if (!NEGATION.test(clause)) {
      continue;
    }

    if (EDIT_ACTION.test(clause)) {
      forbidEdits = true;
    }

    if (EXECUTE_ACTION.test(clause)) {
      forbidExecution = true;
    }
  }

  return {
    readOnly,
    forbidEdits,
    forbidExecution,
    destructive: DESTRUCTIVE_INTENT.test(text),
  };
}

/**
 * Splits a brief into independent clauses so a negation in one clause does not
 * silently apply to the next.
 */
function splitClauses(text: string): string[] {
  return text
    .split(
      /(?:[.;!?]\s*)|(?:,\s*(?:but|however|yet|though|then)\b)|(?:\b(?:but|however|yet)\b)/i,
    )
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

type StepTemplate = Omit<PlanStep, 'id' | 'status' | 'dependsOn'>;

function inspectStep(subject: string): StepTemplate {
  const shortened = subject.length > 88 ? `${subject.slice(0, 88)}…` : subject;

  return {
    title: 'Inspect the workspace',
    detail: `Read the project layout and locate the files the task refers to. Task: “${shortened}”`,
    tool: 'filesystem.read',
    risk: 'low',
    kind: 'read',
    actionType: 'read',
    verification: ['The cited files appear in the scan'],
  };
}

function writeStep(destructive: boolean): StepTemplate {
  return {
    title: destructive
      ? 'Prepare a destructive change set (needs explicit approval)'
      : 'Draft a scoped change set',
    detail: destructive
      ? 'Stage the requested deletions or overwrites in a disposable copy so they can be reviewed before anything is applied.'
      : 'Prepare edits inside a disposable working copy, never the live tree.',
    tool: 'workspace.patch',
    risk: destructive ? 'high' : 'medium',
    kind: 'write',
    actionType: 'edit',
    verification: ['The approved edit matches the reviewed diff'],
  };
}

function executeStep(): StepTemplate {
  return {
    title: 'Run the declared checks',
    detail: 'Execute the project’s own test and typecheck commands and capture exit codes.',
    tool: 'checks.run',
    risk: 'medium',
    kind: 'execute',
    actionType: 'check',
    verification: ['The declared check exits 0'],
  };
}

const SUMMARIZE_STEP: StepTemplate = {
  title: 'Summarize the findings',
  detail: 'Report what was found in plain language, with file paths so it can be checked by hand.',
  tool: 'report.compose',
  risk: 'low',
  kind: 'read',
  actionType: 'report',
  verification: ['The summary cites only scanned paths'],
};

const EVIDENCE_STEP: StepTemplate = {
  title: 'Assemble evidence',
  detail: 'Attach file lists, sizes and timestamps to the run record.',
  tool: 'evidence.collect',
  risk: 'low',
  kind: 'read',
  actionType: 'report',
  verification: ['Hashes and output are recorded'],
};

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'only', 'all', 'any',
  'but', 'not', 'run', 'list', 'show', 'find', 'review', 'audit', 'explain',
  'summarize', 'files', 'file', 'repo', 'repository', 'project', 'folder', 'src',
  'code', 'please', 'about', 'what', 'which', 'them', 'then', 'they',
]);

const MANIFEST_NAMES = new Set([
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'vite.config.js', 'next.config.js', 'dockerfile', 'readme.md', 'go.mod',
  'cargo.toml', 'requirements.txt', 'pyproject.toml', 'composer.json',
  'pubspec.yaml', 'angular.json',
]);

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  TypeScript: ['ts', 'tsx'],
  JavaScript: ['js', 'jsx', 'mjs', 'cjs'],
  Python: ['py'],
  Go: ['go'],
  Rust: ['rs'],
  Java: ['java'],
  'C#': ['cs'],
  Ruby: ['rb'],
  PHP: ['php'],
  Swift: ['swift'],
  Kotlin: ['kt', 'kts'],
  CSS: ['css'],
  SCSS: ['scss'],
  HTML: ['html'],
  SQL: ['sql'],
  Shell: ['sh'],
  PowerShell: ['ps1'],
  Vue: ['vue'],
  Svelte: ['svelte'],
};

const STACK_MEANINGS: Record<string, string> = {
  'Node.js': 'The project is set up as a Node.js package.',
  TypeScript: 'The source is written in TypeScript and has a TypeScript config.',
  React: 'The interface is built from React components.',
  Vite: 'The front-end is bundled with Vite.',
  'Next.js': 'The app uses the Next.js framework.',
  Angular: 'The app uses the Angular framework.',
  Vue: 'The app uses the Vue framework.',
  Svelte: 'The app uses the Svelte framework.',
  'Tailwind CSS': 'Styling is configured through Tailwind CSS.',
  Python: 'The project includes a Python manifest.',
  Django: 'The project looks like a Django application.',
  Go: 'The project is a Go module.',
  Rust: 'The project is a Rust crate.',
  Java: 'The project uses a Java build tool.',
  Ruby: 'The project includes a Ruby Gemfile.',
  PHP: 'The project uses Composer for PHP dependencies.',
  Docker: 'The project ships a Docker build definition.',
  'GitHub Actions': 'Continuous integration is defined with GitHub Actions.',
  Prisma: 'The project uses a Prisma database schema.',
  Flutter: 'The app is built with Flutter.',
  Swift: 'The project uses a Swift package.',
  '.NET': 'The project contains .NET project files.',
};

function representativeFiles(
  language: string,
  files: InspectionResult['files'],
): string[] {
  const extensions = new Set(LANGUAGE_EXTENSIONS[language] ?? []);

  return files
    .filter((file) => extensions.has(file.extension))
    .slice(0, 2)
    .map((file) => file.path);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Deterministic ranking of scanned paths against the brief. */
function selectRelevantFiles(subject: string, inspection: InspectionResult): string[] {
  const tokens = subject
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  const scored = inspection.files.map((file) => {
    const path = file.path.toLowerCase();
    let score = 0;

    for (const token of tokens) {
      if (path.includes(token)) {
        score += 3;
      }
    }

    if (MANIFEST_NAMES.has(file.name.toLowerCase())) {
      score += 4;
    }
    if (/(^|\/)(main|index|app)\.(ts|tsx|js|jsx)$/.test(path)) {
      score += 3;
    }
    if (/(^|\/)src\//.test(path)) {
      score += 1;
    }

    return { file, score };
  });

  scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  return scored
    .filter((entry) => entry.score > 0)
    .slice(0, 4)
    .map((entry) => entry.file.path);
}

function evidenceForSignal(
  signal: PlanFindingLike,
  files: InspectionResult['files'],
): string[] {
  const reason = signal.reason.toLowerCase();

  if (reason.endsWith('*')) {
    const prefix = reason.slice(0, -1);
    return files
      .filter((file) => file.name.toLowerCase().startsWith(prefix))
      .slice(0, 2)
      .map((file) => file.path);
  }

  if (reason.includes('.tsx') || reason.includes('.jsx')) {
    return files
      .filter((file) => file.extension === 'tsx' || file.extension === 'jsx')
      .slice(0, 2)
      .map((file) => file.path);
  }

  return files
    .filter(
      (file) =>
        file.name.toLowerCase() === reason || file.path.toLowerCase() === reason,
    )
    .slice(0, 2)
    .map((file) => file.path);
}

interface PlanFindingLike {
  name: string;
  reason: string;
}

function buildFacts(inspection: InspectionResult): PlanFinding[] {
  const facts: PlanFinding[] = [];
  const files = inspection.files;
  const allManifests = files.filter((file) =>
    MANIFEST_NAMES.has(file.name.toLowerCase()),
  );
  const manifests = allManifests.slice(0, 4);

  if (manifests.length > 0) {
    const hidden = allManifests.length - manifests.length;
    facts.push({
      label: 'Manifests on disk',
      detail: `${manifests.map((file) => file.path).join(', ')}${
        hidden > 0 ? ` (+${hidden} more)` : ''
      }`,
      meaning:
        'These files declare dependencies, build steps and compiler settings. Their contents were not opened.',
      evidence: manifests.map((file) => file.path),
      basis: 'fact',
    });
  }

  for (const signal of inspection.stack.slice(0, 3)) {
    const evidence = evidenceForSignal(signal, files);
    if (evidence.length === 0) {
      continue;
    }

    facts.push({
      label: signal.name,
      detail: `Supported by ${signal.reason}`,
      meaning: STACK_MEANINGS[signal.name] ?? `Files in the repo point to ${signal.name}.`,
      evidence,
      basis: 'fact',
    });
  }

  const primary = inspection.languages[0];
  if (primary) {
    const evidence = representativeFiles(primary.name, files);
    if (evidence.length > 0) {
      facts.push({
        label: `Primary language: ${primary.name}`,
        detail: `${primary.files} of ${files.length} listed files`,
        meaning: `Most of the code in this repo is written in ${primary.name}.`,
        evidence,
        basis: 'fact',
      });
    }
  }

  const testFiles = files.filter((file) => /\.(test|spec)\.[a-z0-9]+$/i.test(file.path));
  if (testFiles.length > 0) {
    facts.push({
      label: 'Test files present',
      detail: `${testFiles.length} test file${testFiles.length === 1 ? '' : 's'} listed`,
      meaning: 'The repo contains automated tests. This plan has not run them.',
      evidence: testFiles.slice(0, 2).map((file) => file.path),
      basis: 'fact',
    });
  }

  return facts;
}

function buildInferences(inspection: InspectionResult | null): PlanFinding[] {
  if (!inspection) {
    return [];
  }

  const inferences: PlanFinding[] = [];
  const stack = new Set(inspection.stack.map((signal) => signal.name));
  const hasPath = (candidate: string) =>
    inspection.files.some((file) => file.path === candidate);

  if (stack.has('Node.js') && stack.has('TypeScript')) {
    const evidence = ['package.json', 'tsconfig.json'].filter(hasPath);
    if (evidence.length > 0) {
      inferences.push({
        label: 'Likely a TypeScript/Node project',
        detail: 'Derived from manifest names only.',
        meaning:
          'The code probably runs on Node.js and is written in TypeScript. Dependencies were not opened to confirm this.',
        evidence,
        basis: 'inference',
      });
    }
  }

  const clientFile = inspection.files.find((file) => file.path.startsWith('client/'));
  const serverFile = inspection.files.find((file) => file.path.startsWith('server/'));
  if (clientFile && serverFile) {
    inferences.push({
      label: 'Split client/server layout',
      detail: 'Top-level client/ and server/ folders are both present.',
      meaning: 'The repo is organised into a front-end and a back-end that are developed together.',
      evidence: [clientFile.path, serverFile.path],
      basis: 'inference',
    });
  }

  if (stack.has('React') || stack.has('Vite')) {
    const evidence = [
      'client/src/App.tsx',
      'client/src/main.tsx',
      'vite.config.ts',
    ].filter(hasPath);
    if (evidence.length > 0) {
      inferences.push({
        label: 'Likely a browser front-end',
        detail: 'React or Vite files are present.',
        meaning:
          'The repo appears to include a web interface. This is inferred from file names; nothing was built or opened.',
        evidence,
        basis: 'inference',
      });
    }
  }

  return inferences.slice(0, 4);
}

function buildLimitations(inspection: InspectionResult | null): string[] {
  const limitations: string[] = [];

  if (!inspection) {
    return [
      'No repository scan was run, so no finding is based on the repo.',
      'File contents were not read; findings rely on names and sizes.',
    ];
  }

  if (inspection.ignored.length > 0) {
    limitations.push(`Skipped ${inspection.ignored.join(', ')} during the scan.`);
  }
  if (inspection.truncated) {
    limitations.push('The scan hit a limit, so counts and findings are partial.');
  }

  const hasTests = inspection.files.some((file) =>
    /\.(test|spec)\.[a-z0-9]+$/i.test(file.path),
  );
  if (!hasTests && !inspection.truncated) {
    limitations.push('No test files were listed, so test coverage was not assessed.');
  }

  limitations.push('File contents were not read; findings rely on names and sizes.');

  return limitations;
}

function buildSteps(
  subject: string,
  inspection: InspectionResult | null,
  constraints: PlanConstraints,
): PlanStep[] {
  if (!subject) {
    return [];
  }

  const wantsWrite = WRITE_INTENT.test(subject) && !constraints.forbidEdits;
  // Checks are opt-in: the step appears only when the brief explicitly asks
  // for tests or checks. Writing a change does not imply running anything.
  const wantsExecute = !constraints.forbidExecution && CHECK_INTENT.test(subject);

  const templates: StepTemplate[] = [];

  if (inspection) {
    const relevant = selectRelevantFiles(subject, inspection);
    templates.push({
      title: 'Review the files found by the scan',
      detail:
        relevant.length > 0
          ? `Start with ${relevant.join(', ')}. These paths were listed in the ${inspection.name} scan.`
          : `The scan of ${inspection.name} listed ${inspection.totalFiles} files; choose the entry points to read first.`,
      tool: 'filesystem.read',
      risk: 'low',
      kind: 'read',
      actionType: 'read',
      verification: ['Each cited path appears in the scan'],
      evidence: relevant,
    });
  } else {
    templates.push(inspectStep(subject));
  }

  if (wantsWrite) {
    templates.push(writeStep(constraints.destructive));
  }

  if (wantsExecute) {
    templates.push(executeStep());
  }

  templates.push(
    inspection
      ? {
          ...SUMMARIZE_STEP,
          detail: `Separate observed facts from inferences and cite the scanned paths.${
            inspection.truncated ? ' Note that the scan was truncated.' : ''
          }`,
        }
      : SUMMARIZE_STEP,
    EVIDENCE_STEP,
  );

  const planned: PlanStep[] = [];

  for (const template of templates) {
    const id = `step-${planned.length + 1}`;
    planned.push({
      ...template,
      id,
      status: 'proposed',
      dependsOn:
        planned.length > 0 ? [planned[planned.length - 1].id] : [],
    });
  }

  return planned;
}

/**
 * Builds a deterministic plan report from the brief and the latest scan.
 *
 * Findings are split into observed facts and inferences. Facts come only from
 * file names, sizes and counts that the scanner returned; file contents are
 * never read, nothing is modified or executed, and no checks are run.
 */
export function buildPlanReport(
  task: string,
  inspection?: InspectionResult | null,
): PlanReport {
  const subject = (typeof task === 'string' ? task : '').trim().replace(/\s+/g, ' ');
  const constraints = derivePlanConstraints(subject);
  const scan = inspection ?? null;

  return {
    brief: subject,
    inspected: scan
      ? {
          name: scan.name,
          root: scan.root,
          totalFiles: scan.totalFiles,
          truncated: scan.truncated,
        }
      : null,
    planner: 'deterministic',
    assumptions: [],
    unknowns: [],
    facts: scan ? buildFacts(scan) : [],
    inferences: buildInferences(scan),
    limitations: buildLimitations(scan),
    steps: buildSteps(subject, scan, constraints),
    constraints,
    note: 'Proposal-only plan. No files were modified and no checks were run.',
  };
}

/** Backwards-compatible helper: the steps of a report without a scan. */
export function buildDemoPlan(task: string): PlanStep[] {
  return buildPlanReport(task, null).steps;
}
