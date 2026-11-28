import { ProductCategory } from './categories';

export interface NormalizedSpec {
  raw: string;
  dimension: string;
  normalizedValue: number;
  unit: string;
}

export interface FilterContext {
  category: ProductCategory;
  productName: string;
  productSpec?: string | null;
  baseSearchName: string;
}

export interface EvaluationResult {
  passed: boolean;
  reason?: string;
  score: number;
  confidence: 'HIGH' | 'MEDIUM';
  note?: string;
}

/**
 * Strip HTML tags from product titles.
 */
export function stripHtml(text: string): string {
  return text.replace(/<[^>]*>?/gm, '');
}

/**
 * Clean ERP-style product names (brackets, promotional tags, underscores) into human search queries.
 */
export function cleanProductNameForQuery(rawName: string): string {
  return rawName
    .replace(/\[[^\]]*\]/g, ' ') // [특가], [당일발송], [기획]
    .replace(/\([^)]*(?:증정|기획|행사|특가|미백|주름|리뉴얼|신형|구형|정품|무료배송|택배)[^)]*\)/gi, ' ')
    .replace(/_(대용량|단품|본품|기획|세트|신형|리뉴얼|NEW)/gi, ' ')
    .replace(/[_/|+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates up to 4 smart fallback search queries automatically so staff never need manual keyword tuning.
 */
export function buildSmartQueries(
  name: string,
  spec?: string | null,
  barcode?: string | null,
  customKeyword?: string | null
): string[] {
  if (customKeyword && customKeyword.trim()) {
    return [customKeyword.trim()];
  }

  const queries: string[] = [];
  const pushUnique = (q?: string | null) => {
    const trimmed = q?.replace(/\s+/g, ' ').trim();
    if (trimmed && trimmed.length >= 2 && !queries.includes(trimmed)) {
      queries.push(trimmed);
    }
  };

  const cleanedName = cleanProductNameForQuery(name);
  const cleanSpec = spec ? spec.trim() : '';

  // Step 1: Cleaned ERP name + spec
  if (cleanSpec && !cleanedName.toLowerCase().includes(cleanSpec.toLowerCase())) {
    pushUnique(`${cleanedName} ${cleanSpec}`);
  } else {
    pushUnique(cleanedName);
  }

  // Step 2: Original raw name + spec (if meaningfully different)
  if (cleanSpec) {
    pushUnique(`${name} ${cleanSpec}`);
  }

  // Step 3: Compact core tokens for overly long ERP names (5+ words -> first 4 meaningful tokens + spec)
  const words = cleanedName.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length >= 5) {
    const compact = words.slice(0, 4).join(' ');
    pushUnique(cleanSpec ? `${compact} ${cleanSpec}` : compact);
  }

  // Step 4: Cleaned name WITHOUT spec (relies on post-search spec filter to pinpoint exact size/count)
  if (cleanSpec) {
    pushUnique(cleanedName);
  }

  // Step 5: Barcode fallback if available
  if (barcode && barcode.trim().length >= 8) {
    pushUnique(`${words.slice(0, 2).join(' ')} ${barcode.trim()}`);
  }

  return queries.slice(0, 4);
}

/**
 * Extracts and normalizes numeric specs (weight, volume, dosage, tablet/pouch counts, etc.)
 * with category-aware unit grouping and metric conversion (e.g. 1kg === 1000g, 1.5L === 1500ml).
 */
export function extractSpecs(text: string, category: ProductCategory = 'COSMETICS'): NormalizedSpec[] {
  const specs: NormalizedSpec[] = [];
  const clean = stripHtml(text);

  const unitPattern =
    category === 'HEALTH_FOOD'
      ? 'mcg|ug|㎍|mg|kg|ml|oz|iu|억마리|억|개월분|개월|일분|일치|캡슐입|캡슐|정입|정|포입|포|스틱입|스틱|구미|젤리|상자|박스|통|병|개입|입|매|장|팩|개|ea|g|l|t|c'
      : category === 'FOOD'
        ? 'mg|kg|ml|oz|인분|상자|박스|개입|봉입|봉지|봉|캔|병|컵|팩|입|구|알|마리|줄|모|단|근|매|장|개|ea|g|l'
        : 'mg|kg|ml|oz|정|캡슐|매|장|팩|개|ea|g|l';

  const regex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})(?![a-zA-Z0-9가-힣])`, 'gi');

  let match: RegExpExecArray | null;
  while ((match = regex.exec(clean)) !== null) {
    const num = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const raw = match[0].replace(/\s+/g, '').toLowerCase();

    if ((unit === 'l' || unit === 't' || unit === 'c') && match.index > 0) {
      const prevChar = clean[match.index - 1];
      if (/[a-zA-Z]/.test(prevChar)) {
        continue;
      }
    }

    const mapped = mapUnitToDimension(num, unit, category);
    if (mapped) {
      specs.push({
        raw,
        dimension: mapped.dimension,
        normalizedValue: mapped.value,
        unit,
      });
    }
  }

  return specs;
}

function mapUnitToDimension(
  num: number,
  unit: string,
  category: ProductCategory
): { dimension: string; value: number } | null {
  if (unit === 'kg') return { dimension: 'mass', value: Math.round(num * 1000 * 1000) / 1000 };
  if (unit === 'g') return { dimension: 'mass', value: num };

  if (unit === 'l') return { dimension: 'volume', value: Math.round(num * 1000 * 1000) / 1000 };
  if (unit === 'ml') return { dimension: 'volume', value: num };

  if (unit === 'mg') return { dimension: 'dosage_mg', value: num };
  if (unit === 'mcg' || unit === 'ug' || unit === '㎍') return { dimension: 'dosage_mcg', value: num };
  if (unit === 'iu') return { dimension: 'dosage_iu', value: num };
  if (unit === '억' || unit === '억마리') return { dimension: 'cfu', value: num };
  if (unit === 'oz') return { dimension: 'oz', value: num };

  if (category === 'HEALTH_FOOD') {
    if (unit === '정' || unit === '정입' || unit === 't') return { dimension: 'count_tablet', value: num };
    if (unit === '캡슐' || unit === '캡슐입' || unit === 'c') return { dimension: 'count_capsule', value: num };
    if (unit === '포' || unit === '포입' || unit === '스틱' || unit === '스틱입') return { dimension: 'count_pouch', value: num };
    if (unit === '구미' || unit === '젤리') return { dimension: 'count_gummy', value: num };
    if (unit === '개월' || unit === '개월분') return { dimension: 'duration_day', value: num * 30 };
    if (unit === '일분' || unit === '일치') return { dimension: 'duration_day', value: num };
    if (unit === '통' || unit === '박스' || unit === '상자' || unit === '병' || unit === '개' || unit === 'ea' || unit === '팩') {
      return { dimension: 'health_pack', value: num };
    }
    return { dimension: `unit_${unit}`, value: num };
  }

  if (category === 'FOOD') {
    if (unit === '박스' || unit === '상자') return { dimension: 'pack_box', value: num };
    if (
      unit === '개' ||
      unit === 'ea' ||
      unit === '입' ||
      unit === '개입' ||
      unit === '봉' ||
      unit === '봉지' ||
      unit === '봉입' ||
      unit === '팩' ||
      unit === '캔' ||
      unit === '병' ||
      unit === '컵'
    ) {
      return { dimension: 'food_count', value: num };
    }
    return { dimension: `unit_${unit}`, value: num };
  }

  return { dimension: `unit_${unit}`, value: num };
}

function valuesMatch(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= Math.max(a, b) * 0.001;
}

/**
 * Detects spec conflicts & dangerous option-listing tricks.
 */
export function hasConflictingSpec(
  originalSpecs: NormalizedSpec[],
  title: string,
  category: ProductCategory = 'COSMETICS'
): boolean {
  const titleSpecs = extractSpecs(title, category);
  if (originalSpecs.length === 0) return false;

  const isPromotion = /(증정|사은품|샘플|덤|미니어처|추가)/i.test(title);

  for (const oSpec of originalSpecs) {
    const titleSpecsSameDim = titleSpecs.filter((s) => s.dimension === oSpec.dimension);
    if (titleSpecsSameDim.length === 0) continue;

    const exactMatch = titleSpecsSameDim.find((s) => valuesMatch(s.normalizedValue, oSpec.normalizedValue));

    if (!exactMatch) {
      return true;
    }

    if (titleSpecsSameDim.length > 1) {
      const hasSmallerSpec = titleSpecsSameDim.some(
        (s) => !valuesMatch(s.normalizedValue, oSpec.normalizedValue) && s.normalizedValue < oSpec.normalizedValue
      );
      if (hasSmallerSpec && !isPromotion) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Category-aware bundle / quantity multiplier filter.
 */
export function passesQuantityFilter(
  originalTitle: string,
  originalSpecs: NormalizedSpec[],
  rawTitle: string,
  category: ProductCategory
): boolean {
  const cleanTitle = stripHtml(rawTitle);

  if (category === 'COSMETICS') {
    const quantityRegex =
      /(x\s*([2-9]|\d{2,})|([2-9]|\d{2,})\s*(개|ea|입|매|p\b|vials?|롤|박스|포|봉|팩)|1\s*\+\s*1|2\s*\+\s*1|세트|세뜨|듀오|더블|기획(?!\s*전))/i;
    if (quantityRegex.test(originalTitle)) return true;
    return !quantityRegex.test(cleanTitle);
  }

  if (category === 'HEALTH_FOOD') {
    const stripInnerComposition = (text: string) =>
      text.replace(
        /\d+(?:\.\d+)?\s*(?:mg|mcg|ug|㎍|g|ml)\s*(?:x|\*)\s*\d+\s*(?:포입|포|스틱입|스틱|정입|정|캡슐입|캡슐|구미|젤리|t|c)(?![a-zA-Z0-9가-힣])/gi,
        ' '
      );

    const originalForBundleCheck = stripInnerComposition(originalTitle);
    const titleForBundleCheck = stripInnerComposition(cleanTitle);

    const healthBundleRegex =
      /((?:x|\*)\s*([2-9]|\d{2,})|([2-9]|\d{2,})\s*(통|박스|상자|개|ea|병|팩|세트|묶음)|1\s*\+\s*1|2\s*\+\s*1|3\s*\+\s*1|세트|세뜨|듀오|더블|트리플)/i;

    const hasOriginalBundle =
      healthBundleRegex.test(originalForBundleCheck) ||
      originalSpecs.some((s) => s.dimension === 'health_pack' && s.normalizedValue >= 2);

    if (!hasOriginalBundle) {
      if (healthBundleRegex.test(titleForBundleCheck)) {
        return false;
      }
      return true;
    }

    const extraMultiplierRegex = /((?:x|\*)\s*([2-9]|\d{2,})|1\s*\+\s*1|2\s*\+\s*1|3\s*\+\s*1|듀오|더블|트리플)/i;
    if (!extraMultiplierRegex.test(originalForBundleCheck) && extraMultiplierRegex.test(titleForBundleCheck)) {
      return false;
    }

    return true;
  }

  // FOOD
  const foodSingleItemBundleRegex =
    /((?:x|\*)\s*([2-9]|\d{2,})|([2-9]|\d{2,})\s*(개|ea|입|개입|봉|봉지|팩|캔|병|컵|박스|상자|묶음|세트)|1\s*\+\s*1|2\s*\+\s*1|3\s*\+\s*1|세트|세뜨|묶음|번들|듀오|더블)/i;
  const hasOriginalCountOrBundle =
    foodSingleItemBundleRegex.test(originalTitle) ||
    originalSpecs.some((s) => (s.dimension === 'food_count' || s.dimension === 'pack_box') && s.normalizedValue >= 2);

  if (!hasOriginalCountOrBundle) {
    const singleItemBoxRegex = /\b1\s*(박스|상자)\b|1박스|1상자/i;
    if (foodSingleItemBundleRegex.test(cleanTitle) || singleItemBoxRegex.test(cleanTitle)) {
      return false;
    }
    return true;
  }

  const foodExtraMultiplierRegex =
    /((?:x|\*)\s*([2-9]|\d{2,})|([2-9]|\d{2,})\s*(박스|상자|세트|묶음|번들)|1\s*\+\s*1|2\s*\+\s*1|3\s*\+\s*1|듀오|더블|트리플)/i;
  if (!foodExtraMultiplierRegex.test(originalTitle) && foodExtraMultiplierRegex.test(cleanTitle)) {
    return false;
  }

  return true;
}

/**
 * Category-aware accessory / bait / expiry-clearance negative keyword filter.
 */
export function passesAccessoryFilter(
  productName: string,
  rawTitle: string,
  category: ProductCategory
): boolean {
  const cleanTitle = stripHtml(rawTitle).toLowerCase();
  const titleWithoutGiftBag = cleanTitle.replace(
    /(쇼핑백|쇼퍼백|선물가방|기프트백|종이가방)\s*(증정|포함|제공|무료|동봉)/gi,
    ''
  );

  if (category === 'COSMETICS') {
    const accessoryRegex = /(리필|refill|케이스|case|퍼프|puff|공병|쇼핑백|뚜껑|쇼퍼백|미니어처|샘플|체험분|증정용)/i;
    if (accessoryRegex.test(productName)) return true;
    return !accessoryRegex.test(titleWithoutGiftBag);
  }

  if (category === 'HEALTH_FOOD') {
    const healthAccessoryRegex =
      /(약통|필케이스|알약케이스|소분|체험팩|체험분|맛보기|낱개|공병|쇼핑백|선물가방|샘플|증정용|미니어처)/i;
    const expiryRegex = /(유통기한\s*임박|소비기한\s*임박|임박\s*특가|임박\s*상품|임박할인)/i;

    if (!healthAccessoryRegex.test(productName) && healthAccessoryRegex.test(titleWithoutGiftBag)) {
      return false;
    }
    if (!expiryRegex.test(productName) && expiryRegex.test(cleanTitle)) {
      return false;
    }
    return true;
  }

  // FOOD
  const foodAccessoryRegex =
    /(시식|맛보기|소스만|양념만|스프만|분말만|보냉백|아이스박스|샘플|체험분|증정용|공병|쇼핑백)/i;
  const foodClearanceRegex = /(유통기한\s*임박|소비기한\s*임박|임박\s*특가|임박\s*상품|임박할인|파지|못난이)/i;

  if (!foodAccessoryRegex.test(productName) && foodAccessoryRegex.test(titleWithoutGiftBag)) {
    return false;
  }
  if (!foodClearanceRegex.test(productName) && foodClearanceRegex.test(cleanTitle)) {
    return false;
  }
  return true;
}

function tokenMatchesTitle(
  token: string,
  titleNoSpecial: string,
  titleSpecs: NormalizedSpec[],
  category: ProductCategory
): boolean {
  if (titleNoSpecial.includes(token)) return true;

  const tokenSpecs = extractSpecs(token, category);
  if (tokenSpecs.length > 0 && titleSpecs.length > 0) {
    return tokenSpecs.every((ts) =>
      titleSpecs.some((candSpec) => candSpec.dimension === ts.dimension && valuesMatch(candSpec.normalizedValue, ts.normalizedValue))
    );
  }

  return false;
}

/**
 * Detects whether the matched candidate specifies a flavor/shade/variant that wasn't in the user's product name.
 */
function detectVariantMismatchNote(originalTitle: string, candidateTitle: string, category: ProductCategory): string | undefined {
  const origLower = originalTitle.toLowerCase();
  const candLower = candidateTitle.toLowerCase();

  const variantKeywords =
    category === 'FOOD'
      ? ['딸기', '바나나', '블루베리', '플레인', '멜론', '망고', '사과', '복숭아', '포도', '초코', '치즈', '매운맛', '순한맛', '오리지널', '제로', '무설탕', '디카페인', '산양']
      : category === 'COSMETICS'
        ? ['17호', '19호', '21호', '22호', '23호', '25호', '쿨톤', '웜톤', '매트', '글로우', '라이트', '내추럴', '베이지', '아이보리', '로지', '코랄']
        : ['키즈', '베이비', '맘스', '시니어', '골드', '코어', '슬림', '뷰티', '키즈용', '성인용', '츄어블', '구미'];

  const extraVariants = variantKeywords.filter((kw) => candLower.includes(kw) && !origLower.includes(kw));
  if (extraVariants.length > 0) {
    return `옵션/맛 확인 (${extraVariants.slice(0, 2).join(', ')})`;
  }
  return undefined;
}

/**
 * Combined relevance, accessory, spec conflict, quantity/bundle, and confidence scoring pipeline.
 */
export function evaluateCandidate(ctx: FilterContext, rawTitle: string): EvaluationResult {
  const { category, productName, productSpec, baseSearchName } = ctx;
  const cleanTitle = stripHtml(rawTitle);
  const originalTitle = `${productName} ${productSpec || ''}`.trim();
  const originalSpecs = extractSpecs(originalTitle, category);

  // 1. Accessory / bait / clearance check
  if (!passesAccessoryFilter(productName, cleanTitle, category)) {
    return { passed: false, reason: 'accessory_or_clearance', score: 0, confidence: 'MEDIUM' };
  }

  // 2. Token relevance check (with ERP noise cleanup & unit-equivalence support)
  const titleNoSpecial = cleanTitle.toLowerCase().replace(/[^a-zA-Z0-9가-힣]/g, '');
  const titleSpecs = extractSpecs(cleanTitle, category);

  const cleanedForTokens = cleanProductNameForQuery(baseSearchName).replace(/[([][^)\]]*[)\]]/g, '');
  const rawTokens = cleanedForTokens.split(/[\s\-/+*&_]+/).filter((t) => t.trim().length > 0);
  const tokens = rawTokens
    .map((t) => t.replace(/[^a-zA-Z0-9가-힣.]/g, '').toLowerCase())
    .map((t) => (/\d\.\d/.test(t) ? t : t.replace(/\./g, '')))
    .filter((t) => t.length > 0);

  let tokenRatio = 1;
  if (tokens.length > 0) {
    let matchCount = 0;
    for (const token of tokens) {
      const normalizedToken = token.replace(/\./g, '');
      if (
        titleNoSpecial.includes(normalizedToken) ||
        tokenMatchesTitle(token, titleNoSpecial, titleSpecs, category)
      ) {
        matchCount++;
      }
    }

    tokenRatio = matchCount / tokens.length;
    const requiredMatches =
      tokens.length <= 2 ? tokens.length : tokens.length <= 4 ? tokens.length - 1 : tokens.length - 2;

    if (matchCount < requiredMatches) {
      return { passed: false, reason: 'low_relevance', score: Math.round(tokenRatio * 50), confidence: 'MEDIUM' };
    }
  }

  // 3. Spec conflict & option-trick check
  if (hasConflictingSpec(originalSpecs, cleanTitle, category)) {
    return { passed: false, reason: 'spec_conflict', score: Math.round(tokenRatio * 60), confidence: 'MEDIUM' };
  }

  // 4. Quantity / multi-pack bundle check
  if (!passesQuantityFilter(originalTitle, originalSpecs, cleanTitle, category)) {
    return { passed: false, reason: 'quantity_bundle', score: Math.round(tokenRatio * 70), confidence: 'MEDIUM' };
  }

  // 5. Confidence & variant check
  const variantNote = detectVariantMismatchNote(originalTitle, cleanTitle, category);
  const hasSpecConfirmed =
    originalSpecs.length === 0 ||
    originalSpecs.every((oSpec) =>
      titleSpecs.some((ts) => ts.dimension === oSpec.dimension && valuesMatch(ts.normalizedValue, oSpec.normalizedValue))
    );

  let confidence: 'HIGH' | 'MEDIUM' = 'HIGH';
  let note = variantNote;

  if (variantNote) {
    confidence = 'MEDIUM';
  } else if (tokenRatio < 0.85 || !hasSpecConfirmed) {
    confidence = 'MEDIUM';
    note = !hasSpecConfirmed ? '규격 표기 미포함 (확인 권장)' : '유사명 매칭 (확인 권장)';
  }

  const score = Math.round(tokenRatio * 80 + (hasSpecConfirmed ? 20 : 5) - (variantNote ? 10 : 0));
  return { passed: true, score, confidence, note };
}

/**
 * When strict filtering yields 0 exact matches, ranks top 3 nearest candidates
 * so staff can confirm with 1 click right inside the table instead of manually searching.
 */
export function pickFallbackRecommendations<T extends { title: string; lprice: string; link: string; mallName: string; image?: string; shipping?: number | null }>(
  ctx: FilterContext,
  candidates: T[],
  limit = 3
): Array<T & { score: number; rejectReason?: string }> {
  const scored: Array<T & { score: number; rejectReason?: string }> = [];

  for (const cand of candidates) {
    const ev = evaluateCandidate(ctx, cand.title);
    if (ev.reason === 'accessory_or_clearance') continue;
    if (ev.score >= 25) {
      scored.push({ ...cand, score: ev.score, rejectReason: ev.reason });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || parseInt(a.lprice, 10) - parseInt(b.lprice, 10))
    .slice(0, limit);
}

/**
 * Price outlier detection.
 */
export function isPriceOutlier(price: number, baselinePrice: number | null): boolean {
  if (!baselinePrice || baselinePrice === 0) return false;
  if (price < baselinePrice * 0.2 || price > baselinePrice * 3) {
    return true;
  }
  return false;
}
