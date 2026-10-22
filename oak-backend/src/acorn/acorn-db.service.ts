import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { MongoClient, type Collection, type Document } from 'mongodb';
import { acornDbName, acornMongoUri } from './acorn.constants';

/** One MongoDB connection to Acorn's database, opened on first use. */
@Injectable()
export class AcornDbService implements OnModuleDestroy {
  private client: Promise<MongoClient> | null = null;

  async collection<T extends Document = Document>(
    name: string,
  ): Promise<Collection<T>> {
    this.client ??= new MongoClient(acornMongoUri()).connect();
    const client = await this.client;
    return client.db(acornDbName()).collection<T>(name);
  }

  async onModuleDestroy(): Promise<void> {
    const client = await this.client?.catch(() => null);
    await client?.close();
    this.client = null;
  }
}
