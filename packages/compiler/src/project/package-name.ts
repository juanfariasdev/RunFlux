/** An npm package name derived from a project name: lower case, ASCII, dash separated. */
export function toPackageName(projectName: string, fallback: string): string {
  return projectName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || fallback;
}

/** A CloudFormation stack name derived from a project name: letters and digits only. */
export function toStackName(projectName: string): string {
  return `${projectName.replace(/[^a-zA-Z0-9]/g, '') || 'Workflow'}Stack`;
}
