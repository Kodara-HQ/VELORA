import {
  BadRequestException, Controller, Global, Injectable, Module, Post, Req, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Request } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AuditService } from '../audit/audit.module';
import { requestContext } from '../../common/utils/request';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_DIR = resolve(process.cwd(), 'uploads');

/** Identify images by their first bytes. The browser-supplied MIME type is never trusted. */
function sniff(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

export interface StoredFile {
  url: string;
  key: string;
  bytes: number;
  mime: string;
}

/**
 * Storage port. The local disk implementation suits development and single-server installs.
 * In production, swap in a Cloudinary / S3-compatible implementation behind the same interface.
 */
@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {}

  private publicBase() {
    return (this.config.get<string>('PUBLIC_UPLOADS_URL') ?? `http://localhost:${this.config.get('PORT') ?? 4000}/uploads`).replace(/\/$/, '');
  }

  async putImage(buf: Buffer, folder: 'products' | 'categories' | 'brands' | 'reviews'): Promise<StoredFile> {
    if (buf.length > MAX_UPLOAD_BYTES) throw new BadRequestException('Images must be 5 MB or smaller');
    const type = sniff(buf);
    if (!type) throw new BadRequestException('Only JPEG, PNG or WebP images are allowed');
    const month = new Date().toISOString().slice(0, 7);
    const key = `${folder}/${month}/${randomBytes(16).toString('hex')}.${type.ext}`;
    const dest = join(UPLOAD_DIR, key);
    if (!dest.startsWith(UPLOAD_DIR)) throw new BadRequestException('Invalid path'); // defence in depth
    await mkdir(join(UPLOAD_DIR, folder, month), { recursive: true });
    await writeFile(dest, buf, { flag: 'wx' });
    return { url: `${this.publicBase()}/${key}`, key, bytes: buf.length, mime: type.mime };
  }
}

@ApiTags('Admin · Uploads')
@ApiBearerAuth()
@Controller('admin/uploads')
export class UploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Post('images')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } }))
  async images(@UploadedFiles() files: Express.Multer.File[] | undefined, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (!files?.length) throw new BadRequestException('Choose at least one image');
    const stored = [];
    for (const f of files) stored.push(await this.storage.putImage(f.buffer, 'products'));
    await this.audit.log({ userId: user.id, action: 'uploads.images', entityType: 'upload', newValues: { keys: stored.map((s) => s.key) }, ctx: requestContext(req) });
    return stored;
  }
}

@Global()
@Module({ controllers: [UploadsController], providers: [StorageService], exports: [StorageService] })
export class UploadsModule {}
