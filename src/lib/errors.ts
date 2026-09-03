/** An error carrying an HTTP status we can hand straight back to our own caller. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** A non-2xx response from Rain, with enough context to debug it. */
export class RainApiError extends HttpError {
  constructor(
    readonly method: string,
    readonly path: string,
    status: number,
    readonly body: unknown,
  ) {
    super(status, `Rain ${method} ${path} failed with ${status}`, body);
    this.name = 'RainApiError';
  }

  /**
   * The simulator 404s both in production and when the tenant is not enabled for it,
   * which is the single most likely reason this POC fails to move money.
   */
  get isSimulatorUnavailable(): boolean {
    return this.status === 404 && this.path.startsWith('/simulate');
  }
}
