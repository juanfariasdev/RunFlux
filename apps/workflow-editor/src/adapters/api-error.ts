/** An answer of the project server that is not a success, with its status and error code. */
export class ProjectApiError extends Error {
  status: number;
  code: string;

  constructor(
    status: number,
    code: string,
    message: string
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ProjectApiError';
  }
}
