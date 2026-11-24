import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { env } from '../../config/env';
import { authService } from './auth.service';
import { createAuthMiddleware, requireAuth } from './auth.middleware';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from './auth.types';

type AuthMiddleware = ReturnType<typeof createAuthMiddleware>;

function authLimiter(limit: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.nodeEnv === 'test',
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many authentication attempts. Please try again later.' } },
  });
}

export function createAuthRouter(service = authService, authenticate: AuthMiddleware = requireAuth): Router {
  const router = Router();

  router.post('/register', authLimiter(5), async (req, res, next) => {
    try {
      const data = await service.register(registerSchema.parse(req.body));
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', authLimiter(10), async (req, res, next) => {
    try {
      const data = await service.login(loginSchema.parse(req.body));
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/refresh', authLimiter(30), async (req, res, next) => {
    try {
      const { refreshToken } = refreshSchema.parse(req.body);
      const data = await service.refresh(refreshToken);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', authLimiter(30), async (req, res, next) => {
    try {
      const { refreshToken } = logoutSchema.parse(req.body);
      await service.logout(refreshToken);
      res.status(200).json({ success: true, data: { loggedOut: true } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', authenticate, (req, res) => {
    res.status(200).json({ success: true, data: req.authUser });
  });

  return router;
}

export const authRouter = createAuthRouter();
