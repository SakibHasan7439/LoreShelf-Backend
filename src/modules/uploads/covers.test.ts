import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import type { RequestHandler } from 'express';

import { errorHandler } from '../../middlewares/error.middleware';
import { AppError } from '../../utils/app-error';
import { createCloudinaryCoverService, MAX_COVER_FILE_SIZE_BYTES } from './covers.service';
import { createUploadsRouter } from './uploads.routes';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cloudName = 'test-cloud';
const coverId = 'cover-11111111-2222-4333-8444-555555555555';
const coverUrl = `https://res.cloudinary.com/${cloudName}/image/upload/v123/loreshelf/users/${userId}/covers/${coverId}.jpg`;

test('signature pins an image to a unique authenticated-user folder and signed public ID', () => {
  let signedParams: unknown;
  let secret: string | undefined;
  const service = createCloudinaryCoverService({ cloudName, apiKey: 'public-key', apiSecret: 'private-secret' }, {
    utils: { api_sign_request: (params, key) => { signedParams = params; secret = key; return 'signature-value'; } },
    api: { resource: async () => ({}) },
  });
  const result = service.createSignature(userId);
  assert.equal(result.signature, 'signature-value');
  assert.equal(result.apiKey, 'public-key');
  assert.equal(result.cloudName, cloudName);
  assert.equal(result.folder, `loreshelf/users/${userId}/covers`);
  assert.match(result.publicId, /^cover-[0-9a-f-]{36}$/u);
  assert.equal(secret, 'private-secret');
  assert.deepEqual(signedParams, {
    allowed_formats: 'jpg,png,webp',
    context: `owner_id=${userId}`,
    folder: result.folder,
    overwrite: false,
    public_id: result.publicId,
    timestamp: result.timestamp,
  });
  assert.equal(result.maxFileSizeBytes, MAX_COVER_FILE_SIZE_BYTES);
  assert.equal(result.expiresAt - result.timestamp, 3600);
  assert.equal(JSON.stringify(result).includes('private-secret'), false);
});

test('cover association verifies Cloudinary ownership, format, and byte limit', async () => {
  let requestedPublicId: string | undefined;
  let resource: unknown = {
    public_id: `loreshelf/users/${userId}/covers/${coverId}`,
    format: 'jpg',
    bytes: 1024,
    context: { custom: { owner_id: userId } },
  };
  const service = createCloudinaryCoverService({ cloudName, apiKey: 'key', apiSecret: 'secret' }, {
    utils: { api_sign_request: () => 'signature' },
    api: { resource: async (publicId) => { requestedPublicId = publicId; return resource; } },
  });
  await service.verifyUserCover(userId, coverUrl);
  assert.equal(requestedPublicId, `loreshelf/users/${userId}/covers/${coverId}`);

  await assert.rejects(service.verifyUserCover('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', coverUrl),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_COVER_UPLOAD');
  resource = { public_id: `loreshelf/users/${userId}/covers/${coverId}`, format: 'jpg', bytes: MAX_COVER_FILE_SIZE_BYTES + 1, context: { custom: { owner_id: userId } } };
  await assert.rejects(service.verifyUserCover(userId, coverUrl),
    (error: unknown) => error instanceof AppError && error.statusCode === 413);
});

test('POST signature route is authenticated and returns the signed upload parameters', async () => {
  const auth: RequestHandler = (req, _res, next) => {
    req.authUser = { id: userId, name: null, email: 'reader@example.com', avatar: null, createdAt: new Date() };
    next();
  };
  const app = express();
  app.use('/api/uploads', createUploadsRouter({ createSignature: (id) => ({
    signature: 'signed', timestamp: 1, expiresAt: 3601, apiKey: 'key', cloudName,
    folder: `users/${id}`, publicId: coverId, allowedFormats: ['jpg', 'png', 'webp'],
    maxFileSizeBytes: MAX_COVER_FILE_SIZE_BYTES, context: `owner_id=${id}`, resourceType: 'image' as const,
  }) }, auth));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/uploads/covers/signature`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: {
      signature: 'signed', timestamp: 1, expiresAt: 3601, apiKey: 'key', cloudName,
      folder: `users/${userId}`, publicId: coverId, allowedFormats: ['jpg', 'png', 'webp'],
      maxFileSizeBytes: MAX_COVER_FILE_SIZE_BYTES, context: `owner_id=${userId}`, resourceType: 'image',
    } });
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
