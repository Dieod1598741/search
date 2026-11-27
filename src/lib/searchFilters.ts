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

/**
 * Strip HTML tags from Naver/Coupang product titles.
 */
export function stripHtml(text: string): string {
  return text.replace(/<[^>]*>?/gm, '');
}

/**
 * Extracts and normalizes numeric specs (weight, volume, dosage, tablet/pouch counts, etc.)
 * with category-aware unit grouping and metric conversion (e.g. 1kg === 1000g, 1.5L === 1500ml).
 */
export function extractSpecs(text: string, category: ProductCategory = 'COSMETICS'): NormalizedSpec[] {
  const specs: NormalizedSpec[] = [];
  const clean = stripHtml(text);

  // Order matters: longer units first so 'ml' matches before 'l', 'kg'/'mg'/'mcg' before 'g', '개입' before '개'
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

    // Prevent single-letter 'l', 't', 'c' when preceded by a letter (e.g. "B12C", "SPF50L" or "21C")
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
  // Mass (kg <-> g conversion)
  if (unit === 'kg') return { dimension: 'mass', value: Math.round(num * 1000 * 1000) / 1000 };
  if (unit === 'g') return { dimension: 'mass', value: num };

  // Volume (L <-> ml conversion)
  if (unit === 'l') return { dimension: 'volume', value: Math.round(num * 1000 * 1000) / 1000 };
  if (unit === 'ml') return { dimension: 'volume', value: num };

  // Active ingredient dosages (keep separate from total net weight)
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

  // COSMETICS (preserve exact original behavior per unit)
  return { dimension: `unit_${unit}`, value: num };
}

function valuesMatch(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= Math.max(a, b) * 0.001;
}

/**
 * Detects spec conflicts & dangerous option-listing tricks (e.g. "30ml / 70ml 선택", "1통 / 3통 선택", "6캔 / 12캔 모음").
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

    // Title specifies this dimension (e.g. ml or 포 or 캔), but does NOT include the requested value
    if (!exactMatch) {
      return true;
    }

    // Title has BOTH the requested spec AND another value in the same dimension (e.g. "30ml / 70ml 선택" or "1통 / 3통")
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
    // Strip inner serving-composition patterns like "2g x 50포", "500mg * 60정", "1000mg x 90캡슐"
    // so they are NOT misclassified as outer multi-pack multipliers ("x 50").
    const stripInnerComposition = (text: string) =>
      text.replace(
        /\d+(?:\.\d+)?\s*(?:mg|mcg|ug|㎍|g|ml)\s*(?:x|\*)\s*\d+\s*(?:포입|포|스틱입|스틱|정입|정|캡슐입|캡슐|구미|젤리|t|c)(?![a-zA-Z0-9가-힣])/gi,
        ' '
      );

    const originalForBundleCheck = stripInnerComposition(originalTitle);
    const titleForBundleCheck = stripInnerComposition(cleanTitle);

    // External container/pack bundles (do NOT ban inner unit counts like 50포, 60정, 90캡슐!)
    const healthBundleRegex =
      /((?:x|\*)\s*([2-9]|\d{2,})|([2-9]|\d{2,})\s*(통|박스|상자|개|ea|병|팩|세트|묶음)|1\s*\+\s*1|2\s*\+\s*1|3\s*\+\s*1|세트|세뜨|듀오|더블|트리플)/i;

    const hasOriginalBundle =
      healthBundleRegex.test(originalForBundleCheck) ||
      originalSpecs.some((s) => s.dimension === 'health_pack' && s.normalizedValue >= 2);

    if (!hasOriginalBundle) {
      // Original is a single pack/box (e.g. "락토핏 골드 50포" or "비타민C 120정") -> block multi-pack listings
      if (healthBundleRegex.test(titleForBundleCheck)) {
        return false;
      }
      return true;
    }

    // Even if original has a pack count (e.g. "활기력 20ml 16병"), block EXTRA multipliers not in original (e.g. "16병 x 2", "1+1")
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
    // Original is a single food item (e.g. "오뚜기 토마토 케찹 500g") -> block multi-packs & boxes
    const singleItemBoxRegex = /\b1\s*(박스|상자)\b|1박스|1상자/i;
    if (foodSingleItemBundleRegex.test(cleanTitle) || singleItemBoxRegex.test(cleanTitle)) {
      return false;
    }
    return true;
  }

  // Original already specifies an item count (e.g. "동원 참치 85g 12캔" or "신라면 5입")
  // Block EXTRA outer multipliers that weren't in the original query (e.g. "5입 x 4", "5입 2팩", "12캔 1+1")
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
  // Remove harmless promotional bag mentions like "쇼핑백 증정", "선물가방 포함" before checking negative keywords
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

/**
 * Checks whether a single token matches the title, including equivalent spec representations
 * (e.g. token "1kg" matches title containing "1000g", token "5입" matches "5봉" in FOOD).
 */
function tokenMatchesTitle(
  token: string,
  titleNoSpecial: string,
  titleSpecs: NormalizedSpec[],
  category: ProductCategory
): boolean {
  if (titleNoSpecial.includes(token)) return true;

  // If the token itself is a spec (e.g. "1kg", "1.5l", "60t", "5입"), check normalized spec equivalence
  const tokenSpecs = extractSpecs(token, category);
  if (tokenSpecs.length > 0 && titleSpecs.length > 0) {
    return tokenSpecs.every((ts) =>
      titleSpecs.some((candSpec) => candSpec.dimension === ts.dimension && valuesMatch(candSpec.normalizedValue, ts.normalizedValue))
    );
  }

  return false;
}

/**
 * Combined relevance, accessory, spec conflict, and quantity/bundle pipeline.
 */
export function evaluateCandidate(ctx: FilterContext, rawTitle: string): { passed: boolean; reason?: string } {
  const { category, productName, productSpec, baseSearchName } = ctx;
  const cleanTitle = stripHtml(rawTitle);
  const originalTitle = `${productName} ${productSpec || ''}`.trim();
  const originalSpecs = extractSpecs(originalTitle, category);

  // 1. Accessory / bait / clearance check
  if (!passesAccessoryFilter(productName, cleanTitle, category)) {
    return { passed: false, reason: 'accessory_or_clearance' };
  }

  // 2. Relaxed token relevance check (with unit-equivalence support)
  const titleNoSpecial = cleanTitle.toLowerCase().replace(/[^a-zA-Z0-9가-힣]/g, '');
  const titleSpecs = extractSpecs(cleanTitle, category);

  const productNameWithoutParens = baseSearchName.replace(/[([][^)\]]*[)\]]/g, '');
  const rawTokens = productNameWithoutParens.split(/[\s\-/+*&_]+/).filter((t) => t.trim().length > 0);
  const tokens = rawTokens
    .map((t) => t.replace(/[^a-zA-Z0-9가-힣.]/g, '').toLowerCase())
    .map((t) => (/\d\.\d/.test(t) ? t : t.replace(/\./g, '')))
    .filter((t) => t.length > 0);

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

    const requiredMatches =
      tokens.length <= 2 ? tokens.length : tokens.length <= 4 ? tokens.length - 1 : tokens.length - 2;

    if (matchCount < requiredMatches) {
      return { passed: false, reason: 'low_relevance' };
    }
  }

  // 3. Spec conflict & option-trick check
  if (hasConflictingSpec(originalSpecs, cleanTitle, category)) {
    return { passed: false, reason: 'spec_conflict' };
  }

  // 4. Quantity / multi-pack bundle check
  if (!passesQuantityFilter(originalTitle, originalSpecs, cleanTitle, category)) {
    return { passed: false, reason: 'quantity_bundle' };
  }

  return { passed: true };
}

/**
 * Price outlier detection (same baseline sanity check across categories).
 */
export function isPriceOutlier(price: number, baselinePrice: number | null): boolean {
  if (!baselinePrice || baselinePrice === 0) return false;
  if (price < baselinePrice * 0.2 || price > baselinePrice * 3) {
    return true;
  }
  return false;
}
