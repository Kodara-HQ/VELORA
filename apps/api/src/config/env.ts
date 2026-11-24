import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, MinLength, validateSync, Min } from 'class-validator';

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
  return env;
}
