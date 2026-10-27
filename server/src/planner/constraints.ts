export interface PlanConstraints {
  readOnly: boolean;
  forbidEdits: boolean;
  forbidExecution: boolean;
  destructive: boolean;
}

const READ_ONLY_PHRASE = /\bread[\s-]?only\b/i;

const NEGATION = /\b(?:no|not|never|don'?t|do not|does not|without|forbid|forbidden|avoid)\b/i;

const EDIT_ACTION =
  /\b(?:edit|edits|editing|modify|modifies|modifying|change|changes|changing|write|writes|writing|patch|patches|patching|refactor|refactoring|update|updates|updating|touch|touches|touching|delete|deletes|deleting|remove|removes|removing|drop|drops|rename|renames|migrate|migrates|create|creates|overwrite|overwrites|wipe|wipes|destroy)\b/i;

const EXECUTE_ACTION =
  /\b(?:run|runs|running|execute|executes|executing|execution|command|commands|shell|script|scripts|subprocess|terminal)\b/i;

const DESTRUCTIVE_INTENT =
  /\b(?:delete|deletes|destroy|drop|drops|wipe|wipes|overwrite|overwrites|remove|removes)\b/i;

function splitClauses(text: string): string[] {
  return text
    .split(
      /(?:[.;!?]\s*)|(?:,\s*(?:but|however|yet|though|then)\b)|(?:\b(?:but|however|yet)\b)/i,
    )
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/**
 * Server-side copy of the brief constraint parser.
 *
 * The planner validates model output against these constraints so a brief that
 * forbids edits or execution can never receive a matching proposed action.
 */
export function derivePlanConstraints(brief: string): PlanConstraints {
  const text = typeof brief === 'string' ? brief : '';
  const readOnly = READ_ONLY_PHRASE.test(text);

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