import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { visibleWhere } from './product-card';

/** Shopper vocabulary → catalogue vocabulary. Each group is treated as one word. */
const SYNONYM_GROUPS = [
  ['sneaker', 'trainer', 'kicks'],
  ['tee', 't-shirt', 'tshirt', 'top'],
  ['trouser', 'pant', 'slack'],
  ['handbag', 'bag', 'purse', 'tote'],
  ['jewellery', 'jewelry', 'jewel'],
  ['earring', 'stud', 'hoop'],
  ['sandal', 'slide', 'slipper', 'chale wote'],
  ['dress', 'gown', 'frock'],
  ['kaftan', 'caftan', 'boubou'],
  ['ankara', 'african print', 'wax print', 'kitenge'],
  ['kente', 'kente cloth'],
  ['smock', 'fugu', 'batakari'],
  ['headwrap', 'head wrap', 'duku', 'gele'],
  ['lipstick', 'lip'],
  ['perfume', 'fragrance', 'scent', 'cologne'],
  ['kid', 'child', 'children', 'baby'],
  ['men', 'man', 'male', 'gents'],
  ['women', 'woman', 'ladies', 'female'],
  ['cushion', 'pillow'],
];
const STOP = new Set(['the', 'a', 'an', 'for', 'and', 'with', 'of', 'in', 'on', 'my', 'to']);

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\- ]+/g, ' ').trim();
/** Very light stemming: "dresses" → "dress", "shoes" → "shoe", "bags" → "bag". */
const stem = (w: string) => (w.length > 4 && w.endsWith('es') && /(ss|sh|ch|x)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

export function expandToken(token: string): string[] {
  const t = stem(token);
  const group = SYNONYM_GROUPS.find((g) => g.some((x) => x === t || x === token));
  return [...new Set([t, token, ...(group ?? [])])].filter((x) => x.length >= 2);
}

export function tokenize(q: string) {
  return norm(q).split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w)).slice(0, 6);
}

function levenshtein(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

interface Doc { id: number; name: string; brand: string; category: string; department: string; material: string; text: string; sold: number }
export interface SearchResult { ids: number[]; correctedFrom: string | null; query: string; engine: 'meilisearch' | 'builtin' }

/**
 * Relevance-ranked product search. Uses Meilisearch when MEILI_HOST is configured and healthy
 * (typo tolerance, fast at any size); otherwise a built-in engine over an in-memory index with
 * synonyms, stemming, field weighting and "did you mean" spelling correction.
 */
@Injectable()
export class SearchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SearchService.name);
  private docs: Doc[] = [];
  private vocabulary: string[] = [];
  private stamp = '';
  private building: Promise<void> | null = null;
  private meili: { host: string; key?: string } | null = null;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const host = config.get<string>('MEILI_HOST');
    if (host) this.meili = { host: host.replace(/\/$/, ''), key: config.get<string>('MEILI_MASTER_KEY') };
  }

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    if (this.meili) {
      const ok = await this.meiliFetch('/health').then((r) => r.ok).catch(() => false);
      if (!ok) {
        this.logger.warn(`Meilisearch at ${this.meili.host} is not reachable; using the built-in search engine.`);
        this.meili = null;
      } else {
        await this.reindex().catch((e) => this.logger.error('Meilisearch indexing failed', e as Error));
        this.timer = setInterval(() => void this.reindex().catch(() => undefined), 10 * 60_000);
      }
    }
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  get engine() { return this.meili ? 'meilisearch' as const : 'builtin' as const; }

  /** Call after catalogue changes so new products are findable straight away. */
  invalidate() { this.stamp = ''; }

  private async load(): Promise<Doc[]> {
    const rows = await this.prisma.product.findMany({
      where: visibleWhere(),
      select: {
        id: true, name: true, material: true, tags: true, shortDescription: true, soldCount: true,
        brand: { select: { name: true } }, category: { select: { name: true, parent: { select: { name: true } } } },
        vendor: { select: { businessName: true } }, variants: { where: { isActive: true, deletedAt: null }, select: { color: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id, name: norm(p.name), brand: norm(`${p.brand?.name ?? ''} ${p.vendor?.businessName ?? ''}`), category: norm(p.category.name),
      department: norm(p.category.parent?.name ?? ''), material: norm(p.material ?? ''), sold: p.soldCount,
      text: norm([p.shortDescription, ...(Array.isArray(p.tags) ? (p.tags as string[]) : []), ...new Set(p.variants.map((v) => v.color))].filter(Boolean).join(' ')),
    }));
  }

  /** Rebuilt whenever the catalogue changes (product, vendor or category edits), checked with one cheap query. */
  private async index() {
    const [row] = await this.prisma.$queryRaw<Array<{ s: string }>>`
      SELECT CONCAT((SELECT COUNT(*) FROM products), '|', COALESCE((SELECT MAX(updated_at) FROM products), ''), '|',
        COALESCE((SELECT MAX(updated_at) FROM vendors), ''), '|', COALESCE((SELECT MAX(updated_at) FROM categories), '')) AS s`;
    if (row?.s && row.s === this.stamp) return;
    this.building ??= (async () => {
      this.docs = await this.load();
      const words = new Set<string>();
      for (const d of this.docs) for (const w of `${d.name} ${d.brand} ${d.category} ${d.department} ${d.material}`.split(/\s+/)) if (w.length >= 3) words.add(stem(w));
      for (const g of SYNONYM_GROUPS) for (const w of g) if (!w.includes(' ')) words.add(w);
      this.vocabulary = [...words];
      this.stamp = row?.s ?? '';
    })().finally(() => { this.building = null; });
    await this.building;
  }

  private score(d: Doc, tokens: string[][]) {
    let total = 0;
    let matched = 0;
    for (const variants of tokens) {
      let best = 0;
      for (const v of variants) {
        const wordStart = new RegExp(`(^|[ -])${v.replace(/[-]/g, '\\-')}`);
        if (wordStart.test(d.name)) best = Math.max(best, 10);
        else if (d.name.includes(v)) best = Math.max(best, 6);
        if (d.brand.includes(v)) best = Math.max(best, 8);
        if (wordStart.test(d.category)) best = Math.max(best, 7);
        if (wordStart.test(d.department)) best = Math.max(best, 4);
        if (d.material.includes(v)) best = Math.max(best, 3);
        if (d.text.includes(v)) best = Math.max(best, 2);
      }
      if (best) matched++;
      total += best;
    }
    return { total, matched };
  }

  private rank(tokens: string[]) {
    const expanded = tokens.map(expandToken);
    const scored = this.docs.map((d) => ({ d, ...this.score(d, expanded) })).filter((x) => x.matched > 0);
    // Products matching every word first; if none do, the best partial matches.
    const all = scored.filter((x) => x.matched === tokens.length);
    // Partial matches only count when the matched words are strong (name, brand or category), not just a department.
    const pool = all.length ? all : scored.filter((x) => x.matched >= Math.ceil(tokens.length / 2) && x.total >= 6);
    return pool.sort((a, b) => b.total - a.total || b.d.sold - a.d.sold).map((x) => x.d.id);
  }

  /** Closest known word for each misspelt token, or null if nothing needed correcting. */
  correct(tokens: string[]): string | null {
    let changed = false;
    const fixed = tokens.map((t) => {
      if (t.length < 4 || this.vocabulary.includes(stem(t))) return t;
      let best: { w: string; d: number } | null = null;
      for (const w of this.vocabulary) {
        const d = levenshtein(stem(t), w);
        if (d <= (t.length > 6 ? 2 : 1) && (!best || d < best.d)) best = { w, d };
      }
      if (best) { changed = true; return best.w; }
      return t;
    });
    return changed ? fixed.join(' ') : null;
  }

  async search(q: string): Promise<SearchResult> {
    const query = q.trim();
    if (this.meili) {
      try {
        const r = await this.meiliFetch('/indexes/products/search', { method: 'POST', body: JSON.stringify({ q: query, limit: 1000, attributesToRetrieve: ['id'] }) });
        if (r.ok) return { ids: ((await r.json()) as { hits: Array<{ id: number }> }).hits.map((h) => h.id), correctedFrom: null, query, engine: 'meilisearch' };
      } catch { /* fall through to the built-in engine */ }
    }
    await this.index();
    const tokens = tokenize(query);
    if (!tokens.length) return { ids: [], correctedFrom: null, query, engine: 'builtin' };
    const ids = this.rank(tokens);
    if (ids.length) return { ids, correctedFrom: null, query, engine: 'builtin' };
    const corrected = this.correct(tokens);
    if (corrected) {
      const retry = this.rank(tokenize(corrected));
      if (retry.length) return { ids: retry, correctedFrom: query, query: corrected, engine: 'builtin' };
    }
    return { ids: [], correctedFrom: null, query, engine: 'builtin' };
  }

  /** A spelling suggestion for the search box, without running the search. */
  async didYouMean(q: string) {
    await this.index();
    const tokens = tokenize(q);
    if (!tokens.length || this.rank(tokens).length) return null;
    return this.correct(tokens);
  }

  // ─── Meilisearch ───

  private meiliFetch(path: string, init: RequestInit = {}) {
    return fetch(`${this.meili!.host}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(this.meili!.key && { Authorization: `Bearer ${this.meili!.key}` }) },
      signal: AbortSignal.timeout(3000),
    });
  }

  async reindex() {
    if (!this.meili) {
      this.invalidate();
      await this.index();
      return { engine: 'builtin' as const, documents: this.docs.length };
    }
    const docs = await this.load();
    await this.meiliFetch('/indexes/products/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        searchableAttributes: ['name', 'brand', 'category', 'department', 'material', 'text'],
        rankingRules: ['words', 'typo', 'proximity', 'attribute', 'exactness', 'sold:desc'],
        synonyms: Object.fromEntries(SYNONYM_GROUPS.flatMap((g) => g.map((w) => [w, g.filter((x) => x !== w)]))),
      }),
    });
    // Replace the whole index so deleted or hidden products disappear.
    await this.meiliFetch('/indexes/products/documents', { method: 'DELETE' });
    const r = await this.meiliFetch('/indexes/products/documents?primaryKey=id', { method: 'POST', body: JSON.stringify(docs) });
    if (!r.ok) throw new Error(`Meilisearch rejected the documents (${r.status})`);
    this.logger.log(`Indexed ${docs.length} products in Meilisearch`);
    return { engine: 'meilisearch' as const, documents: docs.length };
  }
}
