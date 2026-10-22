import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobHardDeleteService } from '../job-hard-delete.service';
import { COMPANY_BLOCK_RULES_MAX } from './constants/company-block.constants';
import { CompanyBlockSearchService } from './company-block-search.service';
import { CompanyBlockStoreService } from './company-block-store.service';
import { buildCompanyBlockRule } from './mappers/company-block-rules.mapper';

@Injectable()
export class CompanyBlockService {
  constructor(
    private readonly store: CompanyBlockStoreService,
    private readonly searchJobs: CompanyBlockSearchService,
    private readonly hardDelete: JobHardDeleteService,
  ) {}

  async list() {
    const snap = await this.store.read();
    return {
      success: true as const,
      rules: snap.rules,
      updatedAt: snap.updatedAt,
      updatedBy: snap.updatedBy,
    };
  }

  async add(companyName: string, createdBy: string) {
    const rule = buildCompanyBlockRule(companyName, createdBy);
    if (!rule) {
      throw new BadRequestException('companyName is required');
    }
    const snap = await this.store.read();
    if (snap.rules.some((row) => row.companyKey === rule.companyKey)) {
      throw new ConflictException('That company is already blocked');
    }
    if (snap.rules.length >= COMPANY_BLOCK_RULES_MAX) {
      throw new BadRequestException(
        `At most ${COMPANY_BLOCK_RULES_MAX} blocked companies`,
      );
    }
    const next = await this.store.write([...snap.rules, rule], createdBy);
    return {
      success: true as const,
      rule,
      rules: next.rules,
      updatedAt: next.updatedAt,
      updatedBy: next.updatedBy,
    };
  }

  async removeRule(id: string, updatedBy: string) {
    const ruleId = id.trim();
    if (!ruleId) throw new BadRequestException('id is required');
    const snap = await this.store.read();
    const nextRules = snap.rules.filter((row) => row.id !== ruleId);
    if (nextRules.length === snap.rules.length) {
      throw new NotFoundException('Block rule not found');
    }
    const next = await this.store.write(nextRules, updatedBy);
    return {
      success: true as const,
      rules: next.rules,
      updatedAt: next.updatedAt,
      updatedBy: next.updatedBy,
    };
  }

  search(companyName: string) {
    return this.searchJobs.search(companyName).then((result) => ({
      success: true as const,
      ...result,
    }));
  }

  async removeJobs(ids: string[]) {
    const [catalog, temp] = await Promise.all([
      this.hardDelete.deleteCatalogJobs(ids),
      this.hardDelete.deleteTempJobs(ids),
    ]);
    return {
      success: true as const,
      catalog,
      temp,
      deletedCount: catalog.deletedCount + temp.deletedCount,
      deletedIds: [...catalog.deletedIds, ...temp.deletedIds],
    };
  }
}
