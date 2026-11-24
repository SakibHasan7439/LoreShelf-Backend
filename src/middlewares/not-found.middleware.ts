import type { RequestHandler } from 'express';

/** Terminal middleware: any request that reaches here matched no route. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}.`,
    },
  });
};
