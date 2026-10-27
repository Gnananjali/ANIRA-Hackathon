import { promises as fs } from 'node:fs';
import path from 'node:path';

export const IGNORED_DIRECTORIES = ['node_modules', '.git', 'dist', 'build'] as const;

const IGNORED = new Set<string>(IGNORED_DIRECTORIES);
const MAX_PATH_LENGTH = 4096;

/** Default caps for a single scan. Exported so callers and tests can tune them. */
export const INSPECT_LIMITS = {
  maxFiles: 2000,
  maxDirectories: 5000,
  maxDepth: 12,
} as const;

export interface InspectOptions {
  maxFiles?: number;
  maxDirectories?: number;
  maxDepth?: number;
}

export type InspectErrorCode =
  | 'invalid_path'
  | 'not_found'
  | 'not_a_directory'
  | 'access_denied';

export class InspectError extends Error {
  constructor(
    public readonly code: InspectErrorCode,
    public readonly status: number,
  ) {
    super(code);
    this.name = 'InspectError';
  }
}

export interface InspectionFile {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
}

export interface InspectionStackSignal {
  name: string;
  reason: string;
}

export interface InspectionLanguage {
  name: string;
  files: number;
}

export interface InspectionResult {
  root: string;
  name: string;
  files: InspectionFile[];
  totalFiles: number;
  totalBytes: number;
  truncated: boolean;
  ignored: string[];
  stack: InspectionStackSignal[];
  languages: InspectionLanguage[];
  scannedAt: string;
}

/**
 * True only when `candidate` is a strict descendant of `root`.
 * Blocks `..` traversal and absolute paths outside the root.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function extensionOf(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

function normalizeInput(input: unknown): string {
  if (typeof input !== 'string') {
    throw new InspectError('invalid_path', 400);
  }

  let value = input.trim();

  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).trim();
  }

  if (!value || value.length > MAX_PATH_LENGTH || value.includes('\0')) {
    throw new InspectError('invalid_path', 400);
  }

  // Reject UNC and device paths: this feature is for local folders only.
  if (value.startsWith('\\\\') || !path.isAbsolute(value)) {
    throw new InspectError('invalid_path', 400);
  }

  return value;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  cs: 'C#',
  rb: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kt: 'Kotlin',
  kts: 'Kotlin',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  sql: 'SQL',
  sh: 'Shell',
  ps1: 'PowerShell',
  vue: 'Vue',
  svelte: 'Svelte',
};

function detectLanguages(files: InspectionFile[]): InspectionLanguage[] {
  const counts = new Map<string, number>();

  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION[file.extension];
    if (language) {
      counts.set(language, (counts.get(language) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, files: count }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name))
    .slice(0, 6);
}

function detectStack(files: InspectionFile[]): InspectionStackSignal[] {
  const paths = new Set(files.map((file) => file.path.toLowerCase()));
  const names = new Set(files.map((file) => file.name.toLowerCase()));
  const countExtension = (extension: string) =>
    files.filter((file) => file.extension === extension).length;
  const hasName = (name: string) => names.has(name);
  const hasPath = (candidate: string) => paths.has(candidate);

  const signals: InspectionStackSignal[] = [];
  const add = (name: string, reason: string) => {
    if (!signals.some((signal) => signal.name === name)) {
      signals.push({ name, reason });
    }
  };

  if (hasName('package.json')) {
    add('Node.js', 'package.json');
  }
  if (hasName('tsconfig.json')) {
    add('TypeScript', 'tsconfig.json');
  }

  const jsxFiles = countExtension('tsx') + countExtension('jsx');
  if (jsxFiles > 0) {
    add('React', `${jsxFiles} .tsx/.jsx file${jsxFiles === 1 ? '' : 's'}`);
  }

  if (
    hasName('vite.config.ts') ||
    hasName('vite.config.js') ||
    hasName('vite.config.mjs')
  ) {
    add('Vite', 'vite.config.*');
  }
  if (
    hasName('next.config.js') ||
    hasName('next.config.ts') ||
    hasName('next.config.mjs')
  ) {
    add('Next.js', 'next.config.*');
  }
  if (hasName('angular.json')) {
    add('Angular', 'angular.json');
  }
  if (hasName('vue.config.js') || countExtension('vue') > 0) {
    add('Vue', 'Vue files');
  }
  if (hasName('svelte.config.js') || countExtension('svelte') > 0) {
    add('Svelte', 'Svelte files');
  }
  if (
    hasName('tailwind.config.js') ||
    hasName('tailwind.config.ts') ||
    hasName('tailwind.config.mjs')
  ) {
    add('Tailwind CSS', 'tailwind.config.*');
  }
  if (
    hasName('requirements.txt') ||
    hasName('pyproject.toml') ||
    hasName('pipfile') ||
    hasName('setup.py')
  ) {
    add('Python', 'Python manifest');
  }
  if (hasName('manage.py')) {
    add('Django', 'manage.py');
  }
  if (hasName('go.mod')) {
    add('Go', 'go.mod');
  }
  if (hasName('cargo.toml')) {
    add('Rust', 'Cargo.toml');
  }
  if (
    hasName('pom.xml') ||
    hasName('build.gradle') ||
    hasName('build.gradle.kts')
  ) {
    add('Java', 'Gradle/Maven build');
  }
  if (hasName('gemfile')) {
    add('Ruby', 'Gemfile');
  }
  if (hasName('composer.json')) {
    add('PHP', 'composer.json');
  }
  if (hasName('dockerfile') || hasName('docker-compose.yml')) {
    add('Docker', 'Dockerfile');
  }
  if ([...paths].some((candidate) => candidate.startsWith('.github/workflows/'))) {
    add('GitHub Actions', '.github/workflows');
  }
  if (hasPath('prisma/schema.prisma')) {
    add('Prisma', 'prisma/schema.prisma');
  }
  if (hasName('pubspec.yaml')) {
    add('Flutter', 'pubspec.yaml');
  }
  if (hasName('package.swift')) {
    add('Swift', 'Package.swift');
  }
  if (files.some((file) => file.extension === 'csproj' || file.extension === 'sln')) {
    add('.NET', 'C# project files');
  }

  return signals.slice(0, 12);
}

export async function inspectRepository(
  input: unknown,
  options: InspectOptions = {},
): Promise<InspectionResult> {
  const limits = {
    maxFiles: options.maxFiles ?? INSPECT_LIMITS.maxFiles,
    maxDirectories: options.maxDirectories ?? INSPECT_LIMITS.maxDirectories,
    maxDepth: options.maxDepth ?? INSPECT_LIMITS.maxDepth,
  };

  const requested = normalizeInput(input);

  let stats;
  try {
    stats = await fs.stat(requested);
  } catch {
    throw new InspectError('not_found', 404);
  }

  if (!stats.isDirectory()) {
    throw new InspectError('not_a_directory', 400);
  }

  let root: string;
  try {
    root = await fs.realpath(requested);
  } catch {
    throw new InspectError('access_denied', 403);
  }

  const files: InspectionFile[] = [];
  const ignored = new Set<string>();
  // `truncated` is reported to the caller. `stopped` is the hard stop used by
  // the file cap; depth and directory caps only prune the branch they hit so
  // the rest of the current directory is still listed.
  const state = { directories: 0, truncated: false, stopped: false };

  async function walk(directory: string, depth: number): Promise<void> {
    if (state.stopped) {
      return;
    }

    if (depth > limits.maxDepth) {
      state.truncated = true;
      return;
    }

    if (state.directories >= limits.maxDirectories) {
      state.truncated = true;
      return;
    }

    state.directories += 1;

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (state.stopped) {
        return;
      }

      // Checked before reading the entry so `truncated` is only set when a file
      // was actually skipped, never when the tree ended exactly on the limit.
      if (files.length >= limits.maxFiles) {
        state.truncated = true;
        state.stopped = true;
        return;
      }

      const fullPath = path.join(directory, entry.name);

      if (!isPathInside(root, fullPath) || entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        const lowerName = entry.name.toLowerCase();
        if (IGNORED.has(lowerName)) {
          ignored.add(lowerName);
          continue;
        }
        await walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let info;
      try {
        info = await fs.lstat(fullPath);
      } catch {
        continue;
      }

      if (!info.isFile() || !isPathInside(root, fullPath)) {
        continue;
      }

      files.push({
        path: path.relative(root, fullPath).split(path.sep).join('/'),
        name: entry.name,
        extension: extensionOf(entry.name),
        sizeBytes: info.size,
      });
    }
  }

  try {
    await walk(root, 0);
  } catch {
    throw new InspectError('access_denied', 403);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);

  return {
    root,
    name: path.basename(root) || root,
    files,
    totalFiles: files.length,
    totalBytes,
    truncated: state.truncated,
    ignored: [...ignored].sort(),
    stack: detectStack(files),
    languages: detectLanguages(files),
    scannedAt: new Date().toISOString(),
  };
}