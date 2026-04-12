/**
 * Shared types for the Knowledge Base module.
 */
import type {
  KBArticleActivityType,
  KBArticleStatus,
} from '@wacrm/database';

export type KBArticleActor =
  | { type: 'user'; userId: string }
  | { type: 'ai' }
  | { type: 'system' }
  | { type: 'public' };

export interface CreateKBArticleDto {
  title: string;
  description?: string;
  content: string;
  category?: string;
  isPublic?: boolean;
  tags?: string[];
  notes?: string;
}

export interface UpdateKBArticleDto {
  title?: string;
  description?: string | null;
  content?: string;
  category?: string | null;
  isPublic?: boolean;
  tags?: string[];
  notes?: string | null;
}

export interface ListKBArticlesFilters {
  status?: KBArticleStatus | KBArticleStatus[];
  category?: string;
  isPublic?: boolean;
  tag?: string;
  search?: string;
  sort?: 'recent' | 'views' | 'title';
  page?: number;
  limit?: number;
}

export interface AddKBArticleActivityInput {
  type: KBArticleActivityType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface KBArticleStatsSnapshot {
  rangeDays: number;
  totalArticles: number;
  byStatus: Record<string, number>;
  publishedArticles: number;
  totalViews: number;
  topCategories: Array<{ category: string; count: number }>;
}

export interface PublicKBArticleDefinition {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content: string;
  category: string | null;
  viewCount: number;
  updatedAt: Date;
  company: { name: string };
}

export interface PublicKBListItem {
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  updatedAt: Date;
}

export interface BulkMutationResult {
  updated: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}
