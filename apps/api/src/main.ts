import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    // `rawBody: true` makes `req.rawBody` available for HMAC signature
    // verification on webhook receivers (Meta Lead Ads, payment providers).
    rawBody: true,
  });

  // ── Security ───────────────────────────────────────────────────────────────
  app.use(helmet());
  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? [`https://${process.env.DOMAIN}`]
      : true,
    credentials: true,
  });

  // ── Global pipes / filters / interceptors ──────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // ── API prefix ────────────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Swagger ───────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('AgenticCRM')
      .setDescription('API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth')
      .addTag('conversations')
      .addTag('contacts')
      .addTag('leads')
      .addTag('deals')
      .addTag('tasks')
      .addTag('payments')
      .addTag('whatsapp')
      .addTag('settings')
      .addTag('analytics')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ── Health check (used by Docker healthcheck) ─────────────────────────────
  const expressApp = app.getHttpAdapter().getInstance() as import('express').Application;
  expressApp.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── Raw body for webhook signature verification ────────────────────────────
  app.useBodyParser('json', { limit: '10mb' });

  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);

  // Increase server timeouts for long AI chat calls (tool iterations can take 2+ minutes)
  const server = app.getHttpServer();
  server.keepAliveTimeout = 300_000;  // 5 minutes
  server.headersTimeout = 305_000;    // slightly above keepAliveTimeout

  console.log(`API running on http://localhost:${port}/api`);
  console.log(`Swagger at http://localhost:${port}/api/docs`);
}

bootstrap();
