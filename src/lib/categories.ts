export type ProductCategory = 'COSMETICS' | 'HEALTH_FOOD' | 'FOOD';

export interface CategoryMeta {
  id: ProductCategory;
  label: string;
  shortLabel: string;
  icon: string;
  searchPlaceholder: string;
  specPlaceholder: string;
  namePlaceholder: string;
  excelSheetName: string;
  templateFileName: string;
  exportPrefix: string;
  description: string;
}

export const CATEGORY_LIST: ProductCategory[] = ['COSMETICS', 'HEALTH_FOOD', 'FOOD'];

export const CATEGORY_META: Record<ProductCategory, CategoryMeta> = {
  COSMETICS: {
    id: 'COSMETICS',
    label: '화장품',
    shortLabel: '화장품',
    icon: '💄',
    searchPlaceholder: '화장품 검색 (상품명, 바코드)',
    namePlaceholder: '예: 토니모리 프리미엄RX 제비집 아이크림',
    specPlaceholder: '예: 70ml',
    excelSheetName: '화장품목록',
    templateFileName: 'product_template_cosmetics.xlsx',
    exportPrefix: 'cosmetics_export',
    description: 'ml·g 용량 비교, 리필/샘플/모음전 차단',
  },
  HEALTH_FOOD: {
    id: 'HEALTH_FOOD',
    label: '건강기능식품',
    shortLabel: '건기식',
    icon: '💊',
    searchPlaceholder: '건기식 검색 (상품명, 바코드)',
    namePlaceholder: '예: 종근당건강 락토핏 골드 50포',
    specPlaceholder: '예: 50포 / 120정 / 2개월분',
    excelSheetName: '건기식목록',
    templateFileName: 'product_template_health_food.xlsx',
    exportPrefix: 'health_food_export',
    description: '정·캡슐·포·개월분 단위 비교, 다통/다박스 묶음 차단',
  },
  FOOD: {
    id: 'FOOD',
    label: '식품류',
    shortLabel: '식품류',
    icon: '🍱',
    searchPlaceholder: '식품 검색 (상품명, 바코드)',
    namePlaceholder: '예: 동원 라이트스탠다드 참치 85g 12캔',
    specPlaceholder: '예: 85g 12캔 / 1.5L 6병 / 5입',
    excelSheetName: '식품목록',
    templateFileName: 'product_template_food.xlsx',
    exportPrefix: 'food_export',
    description: 'kg↔g·L↔ml 자동 환산, 입수/박스/임박상품 정밀 필터',
  },
};

export function normalizeCategory(value?: string | null): ProductCategory {
  if (!value) return 'COSMETICS';
  const upper = String(value).trim().toUpperCase();
  if (upper === 'HEALTH_FOOD' || upper === '건기식' || upper === '건강기능식품') {
    return 'HEALTH_FOOD';
  }
  if (upper === 'FOOD' || upper === '식품' || upper === '식품류') {
    return 'FOOD';
  }
  return 'COSMETICS';
}
