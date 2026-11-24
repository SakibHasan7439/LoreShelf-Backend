import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';

import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';

export const MAX_COVER_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const COVER_ALLOWED_FORMATS = ['jpg', 'png', 'webp'] as const;
const signatureLifetimeSeconds = 60 * 60;

interface CloudinaryCredentials {
  cloudName: string | undefined;
  apiKey: string | undefined;
  apiSecret: string | undefined;
}

interface CloudinarySdk {
  utils: { api_sign_request: (params: Record<string, string | number | boolean>, apiSecret: string) => string };
  api: { resource: (publicId: string, options: Record<string, unknown>) => Promise<unknown> };
}

const cloudinarySdk = cloudinary as unknown as CloudinarySdk;
const unavailable = () => new AppError(503, 'COVER_UPLOAD_UNAVAILABLE', 'Cover upload is not configured.');
const invalidCover = () => new AppError(400, 'INVALID_COVER_UPLOAD', 'The cover image is invalid or does not belong to this user.');

export function createCloudinaryCoverService(
  credentials: CloudinaryCredentials = {
    cloudName: env.cloudinaryCloudName,
    apiKey: env.cloudinaryApiKey,
    apiSecret: env.cloudinaryApiSecret,
  },
  sdk: CloudinarySdk = cloudinarySdk,
) {
  function configured() {
    if (!credentials.cloudName || !credentials.apiKey || !credentials.apiSecret) throw unavailable();
    return { cloudName: credentials.cloudName, apiKey: credentials.apiKey, apiSecret: credentials.apiSecret };
  }

  return {
    createSignature(userId: string) {
      const { cloudName, apiKey, apiSecret } = configured();
      const timestamp = Math.floor(Date.now() / 1000);
      const folder = `loreshelf/users/${userId}/covers`;
      const publicId = `cover-${randomUUID()}`;
      const context = `owner_id=${userId}`;
      const uploadParams = {
        allowed_formats: COVER_ALLOWED_FORMATS.join(','),
        context,
        folder,
        overwrite: false,
        public_id: publicId,
        timestamp,
      };
      return {
        signature: sdk.utils.api_sign_request(uploadParams, apiSecret),
        timestamp,
        expiresAt: timestamp + signatureLifetimeSeconds,
        apiKey,
        cloudName,
        folder,
        publicId,
        allowedFormats: [...COVER_ALLOWED_FORMATS],
        maxFileSizeBytes: MAX_COVER_FILE_SIZE_BYTES,
        context,
        resourceType: 'image' as const,
      };
    },

    async verifyUserCover(userId: string, coverUrl: string): Promise<void> {
      const { cloudName } = configured();
      let parsed: URL;
      try {
        parsed = new URL(coverUrl);
      } catch {
        throw invalidCover();
      }

      const escapedUserId = userId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const match = parsed.pathname.match(new RegExp(`^/${cloudName}/image/upload/(?:v\\d+/)?loreshelf/users/${escapedUserId}/covers/(cover-[0-9a-f-]{36})\\.(jpg|png|webp)$`, 'iu'));
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com' || !match || parsed.search || parsed.hash) {
        throw invalidCover();
      }

      const publicId = `loreshelf/users/${userId}/covers/${match[1]}`;
      let resource: unknown;
      try {
        resource = await sdk.api.resource(publicId, { resource_type: 'image', type: 'upload', context: true });
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'http_code' in error
          ? (error as { http_code?: unknown }).http_code
          : undefined;
        if (status === 404) throw invalidCover();
        throw new AppError(502, 'COVER_STORAGE_UNAVAILABLE', 'Cover storage could not verify the uploaded image.');
      }

      const asset = resource as { public_id?: unknown; format?: unknown; bytes?: unknown; context?: { custom?: Record<string, unknown> } };
      const expectedFormat = match[2]!.toLowerCase();
      if (
        asset.public_id !== publicId || asset.context?.custom?.owner_id !== userId ||
        typeof asset.bytes !== 'number' || asset.bytes <= 0 || asset.bytes > MAX_COVER_FILE_SIZE_BYTES ||
        typeof asset.format !== 'string' || !(COVER_ALLOWED_FORMATS as readonly string[]).includes(asset.format.toLowerCase()) ||
        (expectedFormat === 'jpg' && asset.format.toLowerCase() !== 'jpg' && asset.format.toLowerCase() !== 'jpeg') ||
        (expectedFormat !== 'jpg' && asset.format.toLowerCase() !== expectedFormat)
      ) {
        if (typeof asset.bytes === 'number' && asset.bytes > MAX_COVER_FILE_SIZE_BYTES) {
          throw new AppError(413, 'COVER_FILE_TOO_LARGE', 'Cover images must be 5 MiB or smaller.');
        }
        throw invalidCover();
      }
    },
  };
}

export const cloudinaryCoverService = createCloudinaryCoverService();
