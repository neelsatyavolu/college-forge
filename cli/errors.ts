/** A failure to report to the user as is, with the process exit code to use. */
export class CliError extends Error {
  constructor(
    message: string,
    public exitCode = 1,
  ) {
    super(message);
  }
}

/** Exit code when there's no usable session, so agents can tell "sign in first" from other failures. */
export const NOT_SIGNED_IN = 2;
