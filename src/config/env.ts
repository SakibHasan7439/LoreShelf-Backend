import 'dotenv/config';

import { z } from 'zod';

const DEFAULT_PORT = 4000;
const DEFAULT_CORS_ORIGIN = '*';

const portSchema = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined) return DEFAULT_PORT;
    if (typeof value === 'number') return value;

    const trimmed = value.trim();
    if (trimmed === '') return DEFAULT_PORT;

    return Number(trimmed);
  })
  .pipe(
    z
      .number()
      .int('PORT must be a whole number.')
      .min(1, 'PORT must be between 1 and 65535.')
      .max(65535, 'PORT must be between 1 and 65535.'),
  );

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1, 'DATABASE_URL is required (PostgreSQL connection string).')
  .refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'DATABASE_URL must start with "postgresql://" or "postgres://".',
  );

const rawEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      error: 'NODE_ENV must be one of: development, test, production.',
    })
    .default('development'),
  PORT: portSchema,
  DATABASE_URL: databaseUrlSchema,
  CORS_ORIGIN: z.string().optional(),
  GOOGLE_BOOKS_API_KEY: z.string().trim().min(1).optional(),
  OPEN_LIBRARY_CONTACT: z.string().trim().min(1).max(254).optional(),
  JWT_ACCESS_SECRET: z.string().trim().min(43, 'JWT_ACCESS_SECRET must contain at least 43 characters.').optional(),
  JWT_ISSUER: z.string().trim().min(1).optional(),
  JWT_AUDIENCE: z.string().trim().min(1).optional(),
  CLOUDINARY_CLOUD_NAME: z.string().trim().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().trim().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().trim().min(1).optional(),
}).superRefine((value, ctx) => {
  const authValues = [value.JWT_ACCESS_SECRET, value.JWT_ISSUER, value.JWT_AUDIENCE];
  if (authValues.some(Boolean) && authValues.some((item) => !item)) {
    ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'JWT_ACCESS_SECRET, JWT_ISSUER, and JWT_AUDIENCE must be configured together.' });
  }
  if (value.NODE_ENV === 'production' && authValues.some((item) => !item)) {
    ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'JWT authentication settings are required in production.' });
  }
  const cloudinaryValues = [value.CLOUDINARY_CLOUD_NAME, value.CLOUDINARY_API_KEY, value.CLOUDINARY_API_SECRET];
  if (cloudinaryValues.some(Boolean) && cloudinaryValues.some((item) => !item)) {
    ctx.addIssue({ code: 'custom', path: ['CLOUDINARY_CLOUD_NAME'], message: 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be configured together.' });
  }
});

type RawEnv = z.infer<typeof rawEnvSchema>;

function parseCorsOrigin(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [DEFAULT_CORS_ORIGIN];

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : [DEFAULT_CORS_ORIGIN];
}

function loadEnv(): {
  nodeEnv: RawEnv['NODE_ENV'];
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  corsOrigins: readonly string[];
  googleBooksApiKey: string | undefined;
  openLibraryContact: string | undefined;
  jwtAccessSecret: string | undefined;
  jwtIssuer: string | undefined;
  jwtAudience: string | undefined;
  cloudinaryCloudName: string | undefined;
  cloudinaryApiKey: string | undefined;
  cloudinaryApiSecret: string | undefined;
} {
  const parsed = rawEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        'Create a `.env` file from `.env.example` and fill in the required values.',
    );
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    isProduction: parsed.data.NODE_ENV === 'production',
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    corsOrigins: parseCorsOrigin(parsed.data.CORS_ORIGIN),
    googleBooksApiKey: parsed.data.GOOGLE_BOOKS_API_KEY,
    openLibraryContact: parsed.data.OPEN_LIBRARY_CONTACT,
    jwtAccessSecret: parsed.data.JWT_ACCESS_SECRET,
    jwtIssuer: parsed.data.JWT_ISSUER,
    jwtAudience: parsed.data.JWT_AUDIENCE,
    cloudinaryCloudName: parsed.data.CLOUDINARY_CLOUD_NAME,
    cloudinaryApiKey: parsed.data.CLOUDINARY_API_KEY,
    cloudinaryApiSecret: parsed.data.CLOUDINARY_API_SECRET,
  };
}

/**
 * Validated, typed environment. Importing this module fails fast with a clear
 * message when the configuration is incomplete, so the server never boots with
 * a half-valid setup.
 */
export const env = loadEnv();

export type Env = typeof env;
