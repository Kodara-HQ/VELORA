import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import type { Env } from './config/env';

async function main() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  configureApp(app);
  const config = app.get(ConfigService<Env, true>);
  if (config.get('NODE_ENV', { infer: true }) !== 'production') setupSwagger(app);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`VÉLORA API listening on http://localhost:${port}/api/v1 (docs: /api/docs)`, 'Bootstrap');
}

void main();
