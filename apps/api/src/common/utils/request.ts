import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { RequestContext } from '../types';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 48) => randomBytes(bytes).toString('base64url');

export function requestContext(req: Request): RequestContext {
  return {
    ip: (req.ip ?? null)?.slice(0, 45) ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
  };
}
