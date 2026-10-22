import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExtensionsController } from './extensions.controller';
import { ExtensionsService } from './extensions.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExtensionsController],
  providers: [ExtensionsService],
  exports: [ExtensionsService],
})
export class ExtensionsModule {}
