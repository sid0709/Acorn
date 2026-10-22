import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import http from 'node:http';
import { renderMetrics } from './metrics/metrics-registry';

@Injectable()
export class MetricsServerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsServerService.name);
  private server: http.Server | null = null;

  onModuleInit() {
    const port = Number(process.env.METRICS_PORT || 9101);
    const host = process.env.METRICS_HOST || '0.0.0.0';
    if (
      String(process.env.METRICS_ENABLED || 'true').toLowerCase() === 'false'
    ) {
      return;
    }
    this.server = http.createServer((req, res) => {
      if (req.url !== '/metrics') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/plain; version=0.0.4',
      });
      res.end(renderMetrics('athens-backend'));
    });
    this.server.listen(port, host, () => {
      this.logger.log(`Private metrics listening on ${host}:${port}`);
    });
    this.server.on('error', (error) => {
      this.logger.error(`Metrics listener failed: ${error.message}`);
    });
  }

  onModuleDestroy() {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.close();
  }
}
