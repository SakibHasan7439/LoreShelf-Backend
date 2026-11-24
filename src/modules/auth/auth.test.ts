import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';

import type { PrismaClient } from '../../generated/prisma/client';
import { errorHandler } from '../../middlewares/error.middleware';
import { AppError } from '../../utils/app-error';
import { createAuthMiddleware } from './auth.middleware';
import { createAuthRouter } from './auth.routes';
import { createAuthService } from './auth.service';
import { createAuthTokenManager, hashRefreshToken } from './auth.tokens';

interface TestUser {
  id: string;
  name: string | null;
  email: string;
  avatar: string | null;
  createdAt: Date;
  passwordHash: string | null;
}

interface TestSession {
  id: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  replacedBySessionId: string | null;
}

function fakeDatabase() {
  const users: TestUser[] = [];
  const sessions: TestSession[] = [];
  let transactionTail = Promise.resolve();

  const safeUser = (user: TestUser) => ({ id: user.id, name: user.name, email: user.email, avatar: user.avatar, createdAt: user.createdAt });
  const user = {
    findMany: async ({ where }: { where: { email: { equals: string; mode?: 'insensitive' } } }) => users
      .filter((entry) => entry.email.toLowerCase() === where.email.equals.toLowerCase())
      .slice(0, 2),
    create: async ({ data }: { data: { name: string; email: string; passwordHash: string } }) => {
      const created = { id: randomUUID(), name: data.name, email: data.email, avatar: null, createdAt: new Date(), passwordHash: data.passwordHash };
      users.push(created);
      return safeUser(created);
    },
  };

  const refreshSession = {
    create: async ({ data }: { data: Omit<TestSession, 'id' | 'createdAt' | 'revokedAt' | 'lastUsedAt' | 'replacedBySessionId'> }) => {
      const created: TestSession = { ...data, id: randomUUID(), createdAt: new Date(), revokedAt: null, lastUsedAt: null, replacedBySessionId: null };
      sessions.push(created);
      return { id: created.id };
    },
    findUnique: async ({ where, include }: { where: { refreshTokenHash: string }; include?: { user?: unknown } }) => {
      const found = sessions.find((entry) => entry.refreshTokenHash === where.refreshTokenHash);
      if (!found) return null;
      return include?.user ? { ...found, user: safeUser(users.find((entry) => entry.id === found.userId)!) } : found;
    },
    findFirst: async ({ where }: { where: { id: string; userId: string; revokedAt: null; expiresAt: { gt: Date } } }) => {
      const found = sessions.find((entry) => entry.id === where.id && entry.userId === where.userId && entry.revokedAt === null && entry.expiresAt > where.expiresAt.gt);
      const linkedUser = found && users.find((entry) => entry.id === found.userId);
      return found && linkedUser ? { user: safeUser(linkedUser) } : null;
    },
    updateMany: async ({ where, data }: { where: { id?: string; familyId?: string; refreshTokenHash?: string; revokedAt?: null; expiresAt?: { gt: Date } }; data: { revokedAt: Date; lastUsedAt?: Date } }) => {
      let count = 0;
      for (const entry of sessions) {
        const matches = (!where.id || entry.id === where.id)
          && (!where.familyId || entry.familyId === where.familyId)
          && (!where.refreshTokenHash || entry.refreshTokenHash === where.refreshTokenHash)
          && (where.revokedAt !== null || entry.revokedAt === null)
          && (!where.expiresAt || entry.expiresAt > where.expiresAt.gt);
        if (!matches) continue;
        entry.revokedAt = data.revokedAt;
        if (data.lastUsedAt) entry.lastUsedAt = data.lastUsedAt;
        count += 1;
      }
      return { count };
    },
    update: async ({ where, data }: { where: { id: string }; data: { replacedBySessionId: string } }) => {
      const found = sessions.find((entry) => entry.id === where.id);
      if (!found) throw new Error('Session not found');
      found.replacedBySessionId = data.replacedBySessionId;
      return found;
    },
  };

  const transaction = async (callback: (tx: unknown) => Promise<unknown>) => {
    let release!: () => void;
    const previous = transactionTail;
    transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback({ user, refreshSession });
    } finally {
      release();
    }
  };
  return {
    database: { user, refreshSession, $transaction: transaction } as unknown as PrismaClient,
    users,
    sessions,
  };
}

function testTokens() {
  return createAuthTokenManager({
    secret: 'test-only-secret-with-at-least-32-bytes',
    issuer: 'https://auth.test.local',
    audience: 'loreshelf-test',
  });
}

function appFor(database: PrismaClient, service: ReturnType<typeof createAuthService>, tokens: ReturnType<typeof testTokens>) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(service, createAuthMiddleware(database, tokens.verifyAccessToken)));
  app.use(errorHandler);
  return app;
}

async function withServer<T>(app: express.Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return await run(`http://127.0.0.1:${address.port}/api/auth`);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

test('registration normalizes email, creates a session, and never returns hashes', async () => {
  const state = fakeDatabase();
  const tokens = testTokens();
  const service = createAuthService(state.database, tokens);
  const app = appFor(state.database, service, tokens);
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ' Reader ', email: ' Reader@Example.COM ', password: 'a-long-unique-passphrase' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { data: Record<string, unknown> };
    assert.equal(state.users[0]?.email, 'reader@example.com');
    assert.equal(body.data.user && (body.data.user as Record<string, unknown>).email, 'reader@example.com');
    assert.equal('passwordHash' in (body.data.user as object), false);
    assert.equal('refreshTokenHash' in body.data, false);
    assert.equal(typeof body.data.accessToken, 'string');
    assert.equal(typeof body.data.refreshToken, 'string');
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0]?.refreshTokenHash, hashRefreshToken(body.data.refreshToken as string));

    const duplicate = await fetch(`${base}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Reader', email: 'reader@example.com', password: 'another-long-passphrase' }),
    });
    assert.equal(duplicate.status, 409);
  });
});

test('login succeeds and unknown, wrong-password, and passwordless users get the same generic error', async () => {
  const state = fakeDatabase();
  const tokens = testTokens();
  const service = createAuthService(state.database, tokens);
  const registration = await service.register({ name: 'Reader', email: 'Reader@Example.com', password: 'a-long-unique-passphrase' });
  const login = await service.login({ email: ' READER@example.com ', password: 'a-long-unique-passphrase' });
  assert.equal(login.user.email, 'reader@example.com');
  assert.equal('passwordHash' in login.user, false);
  assert.notEqual(login.refreshToken, registration.refreshToken);

  state.users.push({ id: randomUUID(), name: 'External', email: 'external@example.com', avatar: null, createdAt: new Date(), passwordHash: null });
  const failures = await Promise.all([
    service.login({ email: 'absent@example.com', password: 'a-long-unique-passphrase' }).catch((error: unknown) => error),
    service.login({ email: 'reader@example.com', password: 'wrong-password-value' }).catch((error: unknown) => error),
    service.login({ email: 'external@example.com', password: 'a-long-unique-passphrase' }).catch((error: unknown) => error),
  ]);
  assert.ok(failures.every((error) => error instanceof AppError && error.statusCode === 401 && error.code === 'INVALID_CREDENTIALS' && error.message === 'Email or password is incorrect.'));
});

test('refresh rotates tokens, detects reuse, and revokes the token family', async () => {
  const state = fakeDatabase();
  const tokens = testTokens();
  const service = createAuthService(state.database, tokens);
  const initial = await service.register({ name: 'Reader', email: 'reader@example.com', password: 'a-long-unique-passphrase' });
  const rotated = await service.refresh(initial.refreshToken);
  assert.notEqual(rotated.refreshToken, initial.refreshToken);
  assert.equal(state.sessions[0]?.replacedBySessionId, state.sessions[1]?.id);
  await assert.rejects(service.refresh(initial.refreshToken), (error: unknown) => error instanceof AppError && error.statusCode === 401);
  assert.ok(state.sessions.every((session) => session.revokedAt !== null));
});

test('concurrent refresh requests cannot create multiple active replacement sessions', async () => {
  const state = fakeDatabase();
  const tokens = testTokens();
  const service = createAuthService(state.database, tokens);
  const initial = await service.register({ name: 'Reader', email: 'reader@example.com', password: 'a-long-unique-passphrase' });
  const results = await Promise.allSettled([service.refresh(initial.refreshToken), service.refresh(initial.refreshToken)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(state.sessions.every((session) => session.revokedAt !== null));
  assert.equal(state.sessions.filter((session) => session.revokedAt === null).length, 0);
});

test('logout revokes a session and protected me rejects missing, invalid, expired, and revoked access', async () => {
  const state = fakeDatabase();
  const tokens = testTokens();
  const service = createAuthService(state.database, tokens);
  const app = appFor(state.database, service, tokens);
  const initial = await service.register({ name: 'Reader', email: 'reader@example.com', password: 'a-long-unique-passphrase' });
  await withServer(app, async (base) => {
    const me = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${initial.accessToken}` } });
    assert.equal(me.status, 200);
    const meBody = await me.json() as { data: Record<string, unknown> };
    assert.equal('passwordHash' in meBody.data, false);

    for (const authorization of [undefined, 'Bearer invalid.jwt.token']) {
      const response = await fetch(`${base}/me`, { headers: authorization ? { authorization } : {} });
      assert.equal(response.status, 401);
    }

    const { SignJWT } = await import('jose');
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('https://auth.test.local').setAudience('loreshelf-test')
      .setSubject(state.users[0]!.id).setJti(state.sessions[0]!.id)
      .setIssuedAt(Math.floor(Date.now() / 1_000) - 60)
      .setExpirationTime(Math.floor(Date.now() / 1_000) - 30)
      .sign(new TextEncoder().encode('test-only-secret-with-at-least-32-bytes'));
    const expiredResponse = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${expired}` } });
    assert.equal(expiredResponse.status, 401);

    const logout = await fetch(`${base}/logout`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: initial.refreshToken }),
    });
    assert.equal(logout.status, 200);
    const revokedResponse = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${initial.accessToken}` } });
    assert.equal(revokedResponse.status, 401);
  });
});
