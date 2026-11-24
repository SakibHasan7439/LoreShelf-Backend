import type { ErrorRequestHandler, Response } from 'express';
import { ZodError } from 'zod';

import { AppError, isHttpLikeError } from '../utils/app-error';
import { logger } from '../utils/logger';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function send(res: Response, status: number, body: ErrorBody): void {
  res.status(status).json(body);
}

/**
 * Global error handler. Must be registered last. It never forwards internal
 * messages, stack traces or database details to the client.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  // If the response already started, let Express close the connection.
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    send(res, error.statusCode, {
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof ZodError) {
    send(res, 400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  // Malformed JSON bodies surface as body-parser errors with a 4xx status.
  if (isHttpLikeError(error) && error.status >= 400 && error.status < 500) {
    send(res, error.status, {
      error: {
        code: error.type === 'entity.parse.failed' ? 'INVALID_JSON' : 'BAD_REQUEST',
        message:
          error.type === 'entity.parse.failed'
            ? 'Request body is not valid JSON.'
            : 'The request could not be processed.',
      },
    });
    return;
  }

  logger.error(
    { err: error, method: req.method, url: req.originalUrl },
    'Unhandled request error',
  );

  send(res, 500, {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on our side.',
    },
  });
};
