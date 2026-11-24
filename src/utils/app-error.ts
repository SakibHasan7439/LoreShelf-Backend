/**
 * Error that is safe to translate into an HTTP response. Anything thrown that
 * is not an `AppError` is treated as an unexpected failure and reported as a
 * generic 500 so internals never leak to clients.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static notFound(message = 'Resource not found.'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }
}

/** Narrow an unknown thrown value to something with an HTTP status. */
export function isHttpLikeError(
  error: unknown,
): error is { status: number; type?: string; message?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  );
}
