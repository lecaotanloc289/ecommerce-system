import { Injectable } from '@nestjs/common';
import {
  CategoryDetailSchema,
  CategorySchema,
  CategoryTreeSchema,
  DomainError,
  type Category,
  type CategoryDetail,
  type CategoryNode,
  type CategoryTree,
  type CatalogLocale,
} from '@repo/core';
import { PrismaService } from '../prisma/prisma.service';
import { pickTranslation } from './locale';

interface Loaded {
  category: Category;
  /** Every translation slug (vi and en), so `/categories/:slug` accepts either language's slug. */
  slugs: string[];
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** All categories (a small table) resolved to `locale`, ordered by sortOrder then id. */
  private async loadAll(locale: CatalogLocale): Promise<Loaded[]> {
    const rows = await this.prisma.client.category.findMany({
      include: { translations: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const loaded: Loaded[] = [];
    for (const row of rows) {
      const tr = pickTranslation(row.translations, locale);
      if (!tr) continue; // category without any translation is not renderable
      loaded.push({
        category: CategorySchema.parse({
          id: row.id,
          parentId: row.parentId,
          sortOrder: row.sortOrder,
          name: tr.name,
          slug: tr.slug,
        }),
        slugs: row.translations.map((t) => t.slug),
      });
    }
    return loaded;
  }

  async tree(locale: CatalogLocale): Promise<CategoryTree> {
    const all = await this.loadAll(locale);
    const nodes = new Map<string, CategoryNode>(
      all.map(({ category }) => [category.id, { ...category, children: [] }]),
    );
    const roots: CategoryNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
      // A node whose parent is not renderable is promoted to a root rather than dropped.
      (parent ? parent.children : roots).push(node);
    }
    return CategoryTreeSchema.parse({ items: roots });
  }

  async detail(slug: string, locale: CatalogLocale): Promise<CategoryDetail> {
    const all = await this.loadAll(locale);
    const byId = new Map(all.map((l) => [l.category.id, l.category]));
    const found = all.find((l) => l.slugs.includes(slug));
    if (!found) throw new DomainError('common.error.not-found', { resource: 'category' });

    const breadcrumb: Category[] = [];
    const seen = new Set<string>();
    for (
      let cur: Category | undefined = found.category;
      cur && !seen.has(cur.id);
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId)
    ) {
      seen.add(cur.id);
      breadcrumb.unshift(cur);
    }
    const children = all.map((l) => l.category).filter((c) => c.parentId === found.category.id);
    return CategoryDetailSchema.parse({ ...found.category, breadcrumb, children });
  }

  /**
   * Ids of the category with `slug` (any locale) plus all its descendants, or `null` when the slug
   * is unknown. Used to filter products by category including subcategories.
   */
  async descendantIds(slug: string): Promise<string[] | null> {
    const rows = await this.prisma.client.category.findMany({
      select: { id: true, parentId: true, translations: { select: { slug: true } } },
    });
    const root = rows.find((r) => r.translations.some((t) => t.slug === slug));
    if (!root) return null;
    const ids = new Set([root.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of rows) {
        if (r.parentId !== null && ids.has(r.parentId) && !ids.has(r.id)) {
          ids.add(r.id);
          grew = true;
        }
      }
    }
    return [...ids];
  }
}
