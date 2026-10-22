import { Module } from '@nestjs/common';
import { AcornModule } from './acorn/acorn.module';
import { OakModule } from './oak/oak.module';

@Module({
  imports: [AcornModule, OakModule],
})
export class AppModule {}
