import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MinLength, validateSync, Min } from 'class-validator';

const blankToUndef = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/** Validated at boot: the API refuses to start with missing or weak configuration. */
export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Transform(({ value }) => Number(value)) @IsInt()
  PORT = 4000;

  @IsString()
  CORS_ORIGINS = 'http://localhost:3000';

  @IsString()
  WEB_APP_URL = 'http://localhost:3000';

  @IsString()
  DATABASE_URL: string;

  @IsString() @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET: string;

  @Transform(({ value }) => Number(value)) @IsInt() @Min(60)
  JWT_ACCESS_TTL_SECONDS = 900;

  @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  REFRESH_TOKEN_TTL_DAYS = 30;

  @Transform(toBool) @IsBoolean()
  COOKIE_SECURE = false;

  @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  LOGIN_MAX_FAILED_ATTEMPTS = 5;

  @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  LOGIN_LOCK_MINUTES = 15;

  /** Public base URL of this API (used for provider callback URLs). */
  @IsString()
  API_PUBLIC_URL = 'http://localhost:4000';

  // ─── Payments (each provider is enabled only when its keys are present) ───
  @Transform(blankToUndef) @IsOptional() @IsString() @Matches(/^sk_(test|live)_\w+$/, { message: 'PAYSTACK_SECRET_KEY must look like sk_test_… or sk_live_…' })
  PAYSTACK_SECRET_KEY?: string;

  @Transform(blankToUndef) @IsOptional() @IsString()
  HUBTEL_CLIENT_ID?: string;

  @Transform(blankToUndef) @IsOptional() @IsString()
  HUBTEL_CLIENT_SECRET?: string;

  @Transform(blankToUndef) @IsOptional() @IsString()
  HUBTEL_MERCHANT_ACCOUNT?: string;

  /** Development-only hosted-checkout simulator. Refused in production. */
  @Transform(toBool) @IsBoolean()
  PAYMENT_SIMULATOR = false;

  /** Minutes an unpaid online order holds its stock before it is cancelled. */
  @Transform(({ value }) => Number(value)) @IsInt() @Min(5)
  PAYMENT_TTL_MINUTES = 30;

  // ─── Search (Meilisearch is used when configured and reachable; otherwise the built-in engine) ───
  @Transform(blankToUndef) @IsOptional() @IsString()
  MEILI_HOST?: string;

  @Transform(blankToUndef) @IsOptional() @IsString()
  MEILI_MASTER_KEY?: string;

  // ─── Email and SMS ───
  /** "log" writes messages to the API log (development); "smtp" sends through SMTP_URL. */
  @IsIn(['log', 'smtp'])
  MAIL_DRIVER: 'log' | 'smtp' = 'log';

  @Transform(blankToUndef) @IsOptional() @IsString() @Matches(/^smtps?:\/\//, { message: 'SMTP_URL must look like smtp://user:pass@host:587' })
  SMTP_URL?: string;

  @IsString()
  MAIL_FROM = 'VÉLORA <no-reply@velora.test>';

  /** "log" writes messages to the API log (development); "hubtel" sends through Hubtel SMS. */
  @IsIn(['log', 'hubtel'])
  SMS_DRIVER: 'log' | 'hubtel' = 'log';

  @Transform(blankToUndef) @IsOptional() @IsString()
  HUBTEL_SMS_CLIENT_ID?: string;

  @Transform(blankToUndef) @IsOptional() @IsString()
  HUBTEL_SMS_CLIENT_SECRET?: string;

  @IsString() @Matches(/^[A-Za-z0-9 ]{1,11}$/, { message: 'SMS_SENDER_ID must be 1–11 letters or digits' })
  SMS_SENDER_ID = 'VELORA';
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { exposeDefaultValues: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length) {
    const msg = errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${msg}`);
  }
  if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET.startsWith('replace-with')) {
    throw new Error('JWT_ACCESS_SECRET still has the placeholder value.');
  }
  if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_URL) throw new Error('MAIL_DRIVER=smtp needs SMTP_URL.');
  if (env.SMS_DRIVER === 'hubtel' && !(env.HUBTEL_SMS_CLIENT_ID && env.HUBTEL_SMS_CLIENT_SECRET)) {
    throw new Error('SMS_DRIVER=hubtel needs HUBTEL_SMS_CLIENT_ID and HUBTEL_SMS_CLIENT_SECRET.');
  }
  if (env.NODE_ENV === 'production' && env.PAYMENT_SIMULATOR) {
    throw new Error('PAYMENT_SIMULATOR must never be enabled in production.');
  }
  if (env.NODE_ENV === 'production' && env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
    throw new Error('A Paystack TEST key is configured in production.');
  }
  const hubtel = [env.HUBTEL_CLIENT_ID, env.HUBTEL_CLIENT_SECRET, env.HUBTEL_MERCHANT_ACCOUNT].filter(Boolean).length;
  if (hubtel > 0 && hubtel < 3) throw new Error('Set all of HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET and HUBTEL_MERCHANT_ACCOUNT, or none.');
  return env;
}
