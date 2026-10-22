import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AuthResponseFilter } from './common/auth-response.filter';
import { appLogger } from './common/logger/app-logger';
import { httpAccessLog } from './common/logger/http-access.middleware';
import { NestPinoLogger } from './common/logger/nest-pino.logger';
import { loadAppConfig } from './config/app.config';
import { corsOriginDelegate } from './config/cors-origin';
import { OAK_SOCKET_PATH } from './oak/constants/oak.constants';
import { OakGatewayBootstrap } from './oak/gateway/oak-gateway.bootstrap';

async function bootstrap() {
  const config = loadAppConfig();
  const log = appLogger('bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(new NestPinoLogger());

  // Oak DOM trees need a larger body limit.
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });

  app.setGlobalPrefix('api');
  app.use(httpAccessLog);
  app.useGlobalFilters(new AuthResponseFilter());
  app.enableCors({
    origin: corsOriginDelegate(config.corsOrigins),
    credentials: true,
  });

  await app.init();
  app.get(OakGatewayBootstrap).attach(app.getHttpServer());
  await app.listen(config.port);
  log.info(
    {
      port: config.port,
      url: `http://127.0.0.1:${config.port}/api`,
      oakPath: OAK_SOCKET_PATH,
    },
    'oak-backend listening',
  );
}

void bootstrap();
