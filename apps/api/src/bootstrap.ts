import { INestApplication, UnprocessableEntityException, ValidationError, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';
import { UPLOAD_DIR } from './modules/uploads/uploads.module';

/** Shared by main.ts and the e2e tests so tests exercise the exact production pipeline. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService<Env, true>);
  const express = app as NestExpressApplication;

  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  express.useStaticAssets(UPLOAD_DIR, { prefix: '/uploads/', index: false, dotfiles: 'deny', maxAge: '30d',
    setHeaders: (r) => { r.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); r.setHeader('X-Content-Type-Options', 'nosniff'); } });
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }).split(',').map((s: string) => s.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Velora-Client', 'X-Guest-Id', 'Idempotency-Key'],
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // Field-level errors: [{ field: 'email', messages: ['Enter a valid email address'] }, …]
      exceptionFactory: (errors) =>
        new UnprocessableEntityException({ message: 'Some fields are invalid.', code: 'VALIDATION_FAILED', details: flatten(errors) }),
    }),
  );
  app.enableShutdownHooks();
  return app;
}

function flatten(errors: ValidationError[], parent = ''): Array<{ field: string; messages: string[] }> {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, messages: Object.values(e.constraints) }] : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

export function setupSwagger(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('VÉLORA API')
    .setDescription('REST API for the VÉLORA storefront, mobile apps, admin dashboard and vendor portal.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc), {
    swaggerOptions: { persistAuthorization: true },
  });
}
