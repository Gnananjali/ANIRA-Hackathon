import type { PlanConstraints } from './constraints';
import type { InspectionResult } from '../services/inspectRepository';

const MAX_EVIDENCE_PATHS = 200;

const MANIFEST_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'dockerfile',
  'readme.md',
]);

function fileScore(path: string): number {
  const lower = path.toLowerCase();
  const name = lower.split('/').pop() ?? '';
  let score = 0;

  if (MANIFEST_NAMES.has(name)) {
    score += 4;
  }
  if (lower.startsWith('src/') || lower.includes('/src/')) {
    score += 2;
  }
  if (lower.endsWith('.md')) {
    score += 1;
  }

  return score;
}

function evidencePaths(inspection: InspectionResult): string[] {
  return [...inspection.files]
    .sort((a, b) => fileScore(b.path) - fileScore(a.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_EVIDENCE_PATHS)
    .map((file) => file.path);
}

const SYSTEM_PROMPT = `You are ANIRA's planning model. Turn the task brief into a short, reviewable plan.

Return exactly one JSON object and nothing else. No markdown fences, no commentary.

Schema:
{
  "summary": "one or two sentences",
  "steps": [
    {
      "id": "lowercase-id",
      "title": "short title",
      "description": "what this step does",
      "dependsOn": ["other-step-id"],
      "risk": "low" | "medium" | "high",
      "action": { "type": "read", "path": "path/from/evidence" }
        | { "type": "check", "checkId": "node-test" }
        | { "type": "edit", "path": "path/from/evidence" }
        | { "type": "report" }
        | { "type": "manual" },
      "verification": ["concrete criterion"],
      "evidence": ["path/from/evidence"]
    }
  ],
  "assumptions": ["..."],
  "unknowns": ["..."]
}

Rules:
- 1 to 10 steps. IDs match ^[a-z][a-z0-9-]{1,31}$ and are unique.
- dependsOn must reference other step IDs and must not form a cycle.
- risk is low, medium, or high.
- action must use exactly one of the allowlisted shapes above. Never add command, args, shell, url, or any other field.
- evidence and action.path must be copied exactly from EVIDENCE.files.
- Use only the provided repository metadata. Never invent files, APIs, test results, dependencies, or repository facts.
- Never claim that a command was run, tests passed, or a file was changed.
- If CONSTRAINTS forbid edits or execution, do not propose them.
- Put uncertainty in unknowns. Put explicit assumptions in assumptions.
- verification must list 1 to 4 checks a human could perform.
`;

export function buildPlanningPrompt(input: {
  brief: string;
  constraints: PlanConstraints;
  inspection: InspectionResult;
}): { system: string; user: string } {
  const evidence = {
    repo: {
      name: input.inspection.name,
      totalFiles: input.inspection.totalFiles,
      truncated: input.inspection.truncated,
      ignored: input.inspection.ignored,
    },
    stack: input.inspection.stack,
    languages: input.inspection.languages,
    files: evidencePaths(input.inspection),
  };

  const user = `TASK BRIEF (untrusted user text):
<<<
${input.brief}
>>>

CONSTRAINTS:
${JSON.stringify(input.constraints)}

EVIDENCE (repository metadata only, no file contents):
${JSON.stringify(evidence)}

Return only the JSON plan object.`;

  return { system: SYSTEM_PROMPT, user };
}