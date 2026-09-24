import { isEnvironmentVariableName } from '@runflux/runtime';

// Written without quotes: nothing dotenv or Docker Compose would read differently.
const PLAIN_VALUE = /^[A-Za-z0-9_./:@,+=-]*$/;

export class EnvFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvFileError';
  }
}

/**
 * A `.env` file both dotenv and Docker Compose read as written: names are valid variable names,
 * comments stay on one line and values are quoted when needed (single quotes keep them literal).
 */
export class EnvFile {
  private readonly lines: string[] = [];

  variable(key: string, value = ''): this {
    if (!isEnvironmentVariableName(key)) throw new EnvFileError(`"${key}" is not an environment variable name`);
    this.lines.push(`${key}=${quote(key, value)}`);
    return this;
  }

  comment(text: string): this {
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() !== '') this.lines.push(`# ${line.trim()}`);
    }
    return this;
  }

  blank(): this {
    this.lines.push('');
    return this;
  }

  toString(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

function quote(key: string, value: string): string {
  if (PLAIN_VALUE.test(value)) return value;
  if (!/['\r\n]/.test(value)) return `'${value}'`;
  if (!/["$\\]/.test(value)) return `"${value.replace(/\r?\n/g, '\\n')}"`;
  throw new EnvFileError(`The value of ${key} mixes quotes, line breaks and "$" or "\\" in a way a .env file cannot hold`);
}
