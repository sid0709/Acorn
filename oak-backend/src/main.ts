import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';
import { AuthResponseFilter } from './common/auth-response.filter';
import { appLogger } from './common/logger/app-logger';
import { httpAccessLog } from './common/logger/http-access.middleware';
import { NestPinoLogger } from './common/logger/nest-pino.logger';
import { loadAppConfig } from './config/app.config';
import { corsOriginDelegate } from './config/cors-origin';
import { OakGatewayBootstrap } from './oak/gateway/oak-gateway.bootstrap';
import { backgroundWorkersMode } from './background-tasks/constants/task-types';

async function bootstrap() {
  const config = loadAppConfig();
  const log = appLogger('bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(new NestPinoLogger());

  // Resume bulk uploads + Oak DOM trees need a larger body limit.
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'readyz', method: RequestMethod.GET },
      { path: 'healthz', method: RequestMethod.GET },
    ],
  });
  app.use(httpAccessLog);
  app.useGlobalFilters(new AuthResponseFilter());
  app.enableCors({
    origin: corsOriginDelegate(config.corsOrigins),
    credentials: true,
  });

  await app.init();
  const mode = backgroundWorkersMode();
  if (mode !== 'worker') {
    app.get(OakGatewayBootstrap).attach(app.getHttpServer());
  }
  await app.listen(config.port);
  if (mode !== 'worker') {
    log.info(
      {
        port: config.port,
        mode,
        url: `http://127.0.0.1:${config.port}/api`,
        oakPath: '/oak',
      },
      'athens-backend listening',
    );
  } else {
    log.info(
      {
        port: config.port,
        mode,
        url: `http://127.0.0.1:${config.port}/readyz`,
      },
      'athens-backend worker listening',
    );
  }
}

void bootstrap();
