import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateExtensionDto } from './dto/create-extension.dto';
import { UpdateExtensionDto } from './dto/update-extension.dto';
import {
  withReplicaSetFallback,
  rawInsertOne,
} from '../prisma/mongo-standalone';
@Injectable()
export class ExtensionsService {
  constructor(private readonly prisma: PrismaService) {}

  // async create(createExtensionDto: CreateExtensionDto) {
  //   return this.prisma.extension.create({
  //     data: createExtensionDto,
  //   });
  // }
  async create(input: CreateExtensionDto) {
    await withReplicaSetFallback(
      async () => {
        await this.prisma.extension.create({ data: input });
      },
      () =>
        rawInsertOne(this.prisma, 'extensions', {
          key: input.key,
          name: input.key,
          label: input.key,
          description: input.key,
          version: '1.0.0',
          isActive: true,
        }),
    );
  }
  async findAll() {
    return this.prisma.extension.findMany({});
  }
  async findOrCreateByKey(key: string) {
    const existing = await this.prisma.extension.findUnique({
      where: {
        key,
      },
    });

    if (existing) {
      return existing;
    }

    return withReplicaSetFallback(
      () =>
        this.prisma.extension.create({
          data: {
            key,
            name: key,
            label: key,
            description: key,
            version: '1.0.0',
            isActive: true,
          },
        }),
      async () => {
        await rawInsertOne(this.prisma, 'extensions', {
          key,
          name: key,
          label: key,
          description: key,
          version: '1.0.0',
          isActive: true,
        });
        const created = await this.prisma.extension.findUnique({
          where: { key },
        });

        if (!created) {
          throw new Error(`Failed to create extension: ${key}`);
        }

        return created;
      },
    );
  }
  async findOne(id: string) {
    const extension = await this.prisma.extension.findUnique({
      where: { id },
    });

    if (!extension) {
      throw new NotFoundException(`Extension with ID ${id} not found`);
    }

    return extension;
  }
  async findActiveByKey(key: string) {
    const extension = await this.prisma.extension.findFirst({
      where: {
        key,
        isActive: true,
      },
    });

    if (!extension) {
      throw new NotFoundException(`Active extension "${key}" not found`);
    }

    return extension;
  }
  async update(id: string, updateExtensionDto: UpdateExtensionDto) {
    await this.findOne(id);

    return this.prisma.extension.update({
      where: { id },
      data: updateExtensionDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.extension.delete({
      where: { id },
    });
  }
}
