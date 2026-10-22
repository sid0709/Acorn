import { randomBytes } from 'node:crypto';
import { COMPANY_BLOCK_RULES_MAX } from '../constants/company-block.constants';
import { normalizeCompanyKey } from '../../lib/company-key';

export type CompanyBlockRule = {
  id: string;
  companyName: string;
  companyKey: string;
  createdAt: string;
  createdBy: string;
};

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function asNonEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function newCompanyBlockRuleId(): string {
  return randomBytes(12).toString('hex');
}

export function parseCompanyBlockRules(raw: unknown): CompanyBlockRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rules: CompanyBlockRule[] = [];
  for (const item of raw) {
    if (rules.length >= COMPANY_BLOCK_RULES_MAX) break;
    const row = asObject(item);
    if (!row) continue;
    const companyName = asNonEmpty(row.companyName);
    const companyKey =
      asNonEmpty(row.companyKey) || normalizeCompanyKey(companyName);
    const id = asNonEmpty(row.id);
    if (!id || !companyName || !companyKey || seen.has(companyKey)) continue;
    seen.add(companyKey);
    const createdAt = asNonEmpty(row.createdAt) || new Date().toISOString();
    rules.push({
      id,
      companyName,
      companyKey,
      createdAt,
      createdBy: asNonEmpty(row.createdBy),
    });
  }
  return rules;
}

export function buildCompanyBlockRule(
  companyName: string,
  createdBy: string,
  now = new Date(),
): CompanyBlockRule | null {
  const name = companyName.trim();
  const companyKey = normalizeCompanyKey(name);
  if (!name || !companyKey) return null;
  return {
    id: newCompanyBlockRuleId(),
    companyName: name,
    companyKey,
    createdAt: now.toISOString(),
    createdBy: createdBy.trim(),
  };
}
