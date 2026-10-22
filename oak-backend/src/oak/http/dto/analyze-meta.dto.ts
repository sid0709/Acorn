import { Allow } from 'class-validator';

export class OakAnalyzeMetaDto {
  /** Custom list-item `meta` field (string or DOM-like tree). */
  @Allow()
  meta!: unknown;
}
