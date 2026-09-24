/** An npm package name derived from a project name: lower case, ASCII, dash separated. */
export function toPackageName(projectName: string, fallback: string): string {
  return withoutAccents(projectName.toLowerCase())
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || fallback;
}

const STACK_SUFFIX = 'Stack';
const MAX_STACK_NAME = 128;

/**
 * A CloudFormation stack name derived from a project name: ASCII letters and digits, starting with
 * a letter, ending in `Stack` and at most 128 characters long.
 */
export function toStackName(projectName: string): string {
  const letters = withoutAccents(projectName).replace(/[^a-zA-Z0-9]/g, '');
  const base = /^[A-Za-z]/.test(letters) ? letters : `Workflow${letters}`;
  return `${base.slice(0, MAX_STACK_NAME - STACK_SUFFIX.length)}${STACK_SUFFIX}`;
}

function withoutAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
