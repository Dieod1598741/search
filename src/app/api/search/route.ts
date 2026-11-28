import { NextRequest, NextResponse } from 'next/server';
import pool, { ensureProductSchema } from '@/lib/db';
import { normalizeCategory } from '@/lib/categories';
import {
  buildSmartQueries,
  evaluateCandidate,
  isPriceOutlier,
  pickFallbackRecommendations,
} from '@/lib/searchFilters';
import {
  fetchAggregatedCandidates,
  scrapeEnuriCatalogOffers,
  ScrapedItem,
} from '@/lib/scrapers';

interface ScoredCandidate {
  item: ScrapedItem;
  price: number;
  effectivePrice: number;
  score: number;
  confidence: 'HIGH' | 'MEDIUM';
  note?: string;
}

export async function POST(req: NextRequest) {
  try {
    await ensureProductSchema();
    const { productId, customKeyword, includeShipping } = await req.json();

    const { rows: productRows } = await pool.query('SELECT * FROM "Product" WHERE id = $1', [productId]);
    const product = productRows[0];

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (product.isManualOverride) {
      return NextResponse.json({
        success: true,
        product,
        blockedChannels: [],
        note: 'Skipped automated search due to manual override',
      });
    }

    const category = normalizeCategory(product.category);
    const queries = buildSmartQueries(product.name, product.spec, product.barcode, customKeyword);
    const baseSearchName = customKeyword || product.name;
    const filterCtx = {
      category,
      productName: product.name,
      productSpec: product.spec,
      baseSearchName,
    };

    const allCollected: ScrapedItem[] = [];
    const blockedSet = new Set<'naver' | 'coupang'>();
    const best: {
      naver: ScoredCandidate | null;
      coupang: ScoredCandidate | null;
      openMarket: ScoredCandidate | null;
    } = {
      naver: null,
      coupang: null,
      openMarket: null,
    };

    const baselinePrice = product.currentPrice || product.purchasePrice || null;

    const evaluateAndPick = (items: ScrapedItem[]) => {
      const passed: ScoredCandidate[] = [];

      for (const item of items) {
        const ev = evaluateCandidate(filterCtx, item.title);
        if (!ev.passed) continue;

        const price = parseInt(item.lprice, 10);
        if (isNaN(price) || price <= 0) continue;

        const effectivePrice =
          includeShipping && item.shipping !== null ? price + item.shipping : price;

        passed.push({
          item,
          price,
          effectivePrice,
          score: ev.score,
          confidence: ev.confidence,
          note: ev.note,
        });
      }

      if (passed.length === 0) return;

      const sane = passed.filter((c) => !isPriceOutlier(c.price, baselinePrice));
      const poolToRank = sane.length > 0 ? sane : passed;

      const sortCandidates = (list: ScoredCandidate[]) =>
        list.sort((a, b) => {
          if (a.confidence !== b.confidence) {
            return a.confidence === 'HIGH' ? -1 : 1;
          }
          return a.effectivePrice - b.effectivePrice;
        });

      const naverList = sortCandidates(poolToRank.filter((c) => c.item.channel === 'NAVER'));
      const coupangList = sortCandidates(poolToRank.filter((c) => c.item.channel === 'COUPANG'));
      const openList = sortCandidates(poolToRank.filter((c) => c.item.channel === 'OPEN_MARKET'));

      if (naverList[0] && (!best.naver || naverList[0].effectivePrice < best.naver.effectivePrice)) {
        best.naver = naverList[0];
      }
      if (coupangList[0] && (!best.coupang || coupangList[0].effectivePrice < best.coupang.effectivePrice)) {
        best.coupang = coupangList[0];
      }
      if (openList[0] && (!best.openMarket || openList[0].effectivePrice < best.openMarket.effectivePrice)) {
        best.openMarket = openList[0];
      }
    };

    // Multi-stage automatic query fallback
    for (let qIdx = 0; qIdx < queries.length; qIdx++) {
      const query = queries[qIdx];
      const hasAnySolid = Boolean(best.openMarket || best.naver || best.coupang);
      if (qIdx > 0 && hasAnySolid && (best.naver || best.coupang)) break;
      if (qIdx >= 2 && hasAnySolid) break;

      const { items, blockedChannels } = await fetchAggregatedCandidates(query, {
        port: process.env.PORT,
        includeSessionChannels: Boolean(process.env.PORT) && qIdx === 0,
      });

      blockedChannels.forEach((ch) => blockedSet.add(ch));
      allCollected.push(...items);

      const passingCatalogs = items
        .filter((it) => Boolean(it.catalogUrl) && evaluateCandidate(filterCtx, it.title).passed)
        .sort((a, b) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10))
        .slice(0, 2);

      let deepOffers: ScrapedItem[] = [];
      if (passingCatalogs.length > 0) {
        const offerBatches = await Promise.all(
          passingCatalogs.map((cat) =>
            scrapeEnuriCatalogOffers(cat.catalogUrl!, cat.title, cat.image)
          )
        );
        deepOffers = offerBatches.flat();
        allCollected.push(...deepOffers);
      }

      evaluateAndPick(deepOffers.length > 0 ? [...deepOffers, ...items.filter((i) => !i.catalogUrl)] : items);
      if (!best.openMarket) {
        evaluateAndPick(items);
      }
    }

    // Determine overall winning match metadata (lowest price across all 3 channels)
    const winners = [best.naver, best.coupang, best.openMarket].filter(
      (c): c is ScoredCandidate => c !== null
    );
    winners.sort((a, b) => a.effectivePrice - b.effectivePrice);
    const overallBest = winners[0] || null;

    const fallbackRecs = overallBest
      ? []
      : pickFallbackRecommendations(filterCtx, allCollected, 3).map((rec) => ({
          title: rec.title,
          lprice: rec.lprice,
          link: rec.link,
          mallName: rec.mallName,
          channel: rec.channel,
          shipping: rec.shipping,
          image: rec.image || '',
          rejectReason: rec.rejectReason || null,
        }));

    const updates: string[] = ['"lastCheckedAt" = $1'];
    const values: any[] = [new Date()];
    let paramIdx = 2;

    if (best.naver) {
      updates.push(`"naverPrice" = $${paramIdx++}`);
      values.push(best.naver.price);
      updates.push(`"naverLink" = $${paramIdx++}`);
      values.push(best.naver.item.link);
      updates.push(`"naverShipping" = $${paramIdx++}`);
      values.push(best.naver.item.shipping);
    }

    if (best.coupang) {
      updates.push(`"coupangPrice" = $${paramIdx++}`);
      values.push(best.coupang.price);
      updates.push(`"coupangLink" = $${paramIdx++}`);
      values.push(best.coupang.item.link);
      updates.push(`"coupangShipping" = $${paramIdx++}`);
      values.push(best.coupang.item.shipping);
    }

    if (best.openMarket) {
      updates.push(`"openMarketPrice" = $${paramIdx++}`);
      values.push(best.openMarket.price);
      updates.push(`"openMarketLink" = $${paramIdx++}`);
      values.push(best.openMarket.item.link);
      updates.push(`"openMarketMall" = $${paramIdx++}`);
      values.push(best.openMarket.item.mallName);
      updates.push(`"openMarketShipping" = $${paramIdx++}`);
      values.push(best.openMarket.item.shipping);
    }

    if (overallBest) {
      updates.push(`"matchedTitle" = $${paramIdx++}`);
      values.push(overallBest.item.title);
      updates.push(`"matchConfidence" = $${paramIdx++}`);
      values.push(overallBest.confidence);
      updates.push(`"matchNote" = $${paramIdx++}`);
      values.push(overallBest.note || null);
      updates.push(`"candidateJson" = $${paramIdx++}`);
      values.push(null);
    } else {
      updates.push(`"candidateJson" = $${paramIdx++}`);
      values.push(fallbackRecs.length > 0 ? JSON.stringify(fallbackRecs) : null);
    }

    values.push(productId);
    const queryStr = `UPDATE "Product" SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`;

    const { rows: updatedRows } = await pool.query(queryStr, values);
    const updatedProduct = updatedRows[0];

    return NextResponse.json({
      success: true,
      product: updatedProduct,
      blockedChannels: Array.from(blockedSet),
    });
  } catch (error) {
    console.error('Search API Error:', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
}
