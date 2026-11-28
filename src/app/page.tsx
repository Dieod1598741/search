'use client';

import React, { useState, useEffect, useRef } from 'react';
import packageJson from '../../package.json';
import * as XLSX from 'xlsx';
import {
  CATEGORY_LIST,
  CATEGORY_META,
  normalizeCategory,
  ProductCategory,
} from '@/lib/categories';
import './globals.css';

type RecommendedCandidate = {
  title: string;
  lprice: string;
  link: string;
  mallName: string;
  channel: 'NAVER' | 'COUPANG' | 'OPEN_MARKET';
  shipping: number | null;
  image?: string;
  rejectReason?: string | null;
};

type Product = {
  id: number;
  name: string;
  spec?: string;
  barcode?: string;
  category?: ProductCategory;
  currentPrice: number;
  naverPrice?: number | null;
  naverLink?: string | null;
  naverShipping?: number | null;
  coupangPrice?: number | null;
  coupangLink?: string | null;
  coupangShipping?: number | null;
  openMarketPrice?: number | null;
  openMarketLink?: string | null;
  openMarketMall?: string | null;
  openMarketShipping?: number | null;
  matchedTitle?: string | null;
  matchConfidence?: 'HIGH' | 'MEDIUM' | null;
  matchNote?: string | null;
  candidateJson?: string | null;
  supplier?: string;
  lastCheckedAt?: string;
  isManualOverride?: boolean;
};

type StatusFilter = 'ALL' | 'FOUND' | 'ADJUST_NEEDED' | 'CHECK_RECOMMENDED' | 'UNSEARCHED';
type SortKey = 'name' | 'currentPrice' | 'naverPrice' | 'coupangPrice' | 'openMarketPrice' | 'diff';

function getEffectiveChannelPrice(
  price?: number | null,
  shipping?: number | null,
  includeShipping = false
): number | null {
  if (price === null || price === undefined) return null;
  if (includeShipping && shipping !== null && shipping !== undefined) {
    return price + shipping;
  }
  return price;
}

function getBestOnlineMetrics(product: Product, includeShipping: boolean) {
  const channels: Array<{
    key: 'NAVER' | 'COUPANG' | 'OPEN_MARKET';
    label: string;
    price: number;
    effective: number;
    link?: string | null;
  }> = [];

  const nEff = getEffectiveChannelPrice(product.naverPrice, product.naverShipping, includeShipping);
  if (nEff !== null && product.naverPrice != null) {
    channels.push({ key: 'NAVER', label: '네이버', price: product.naverPrice, effective: nEff, link: product.naverLink });
  }

  const cEff = getEffectiveChannelPrice(product.coupangPrice, product.coupangShipping, includeShipping);
  if (cEff !== null && product.coupangPrice != null) {
    channels.push({ key: 'COUPANG', label: '쿠팡', price: product.coupangPrice, effective: cEff, link: product.coupangLink });
  }

  const oEff = getEffectiveChannelPrice(product.openMarketPrice, product.openMarketShipping, includeShipping);
  if (oEff !== null && product.openMarketPrice != null) {
    channels.push({
      key: 'OPEN_MARKET',
      label: product.openMarketMall || '오픈마켓',
      price: product.openMarketPrice,
      effective: oEff,
      link: product.openMarketLink,
    });
  }

  if (channels.length === 0) {
    return {
      hasOnlinePrice: false,
      lowestPrice: null as number | null,
      lowestLabel: null as string | null,
      lowestLink: null as string | null,
      diffAmount: null as number | null,
      diffPct: null as number | null,
      isExpensive: false,
    };
  }

  channels.sort((a, b) => a.effective - b.effective);
  const best = channels[0];
  const hasCurrentPrice = product.currentPrice > 0;
  const diffAmount = hasCurrentPrice ? best.effective - product.currentPrice : null; // negative means online is cheaper
  const diffPct = hasCurrentPrice && diffAmount !== null ? Math.round((diffAmount / product.currentPrice) * 100) : null;
  const isExpensive = hasCurrentPrice && product.currentPrice > best.effective;

  return {
    hasOnlinePrice: true,
    lowestPrice: best.effective,
    lowestLabel: best.label,
    lowestLink: best.link || null,
    diffAmount,
    diffPct,
    isExpensive,
  };
}

function parseRecommendations(jsonStr?: string | null): RecommendedCandidate[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Active Category Tab
  const [activeCategory, setActiveCategory] = useState<ProductCategory>('COSMETICS');

  // Progress, Parallel Batch & Session States
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [blockedChannels, setBlockedChannels] = useState<Array<'naver' | 'coupang'>>([]);
  const [includeShipping, setIncludeShipping] = useState(false);
  const [expandedRecIds, setExpandedRecIds] = useState<Set<number>>(new Set());
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const stopRequestedRef = useRef(false);

  // Settings Modal
  const [showSettings, setShowSettings] = useState(false);

  // Filter states
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('ALL');
  const [filterSupplier, setFilterSupplier] = useState<string>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  // Sort states
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  // Edit states
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({
    category: 'COSMETICS' as ProductCategory,
    currentPrice: '',
    naverPrice: '',
    naverLink: '',
    coupangPrice: '',
    coupangLink: '',
    openMarketPrice: '',
    openMarketLink: '',
    openMarketMall: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [tuningProduct, setTuningProduct] = useState<{ id: number; name: string; keyword: string } | null>(null);

  // Manual Add Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<'single' | 'bulk'>('single');
  const [addForm, setAddForm] = useState({
    category: 'COSMETICS' as ProductCategory,
    name: '',
    spec: '',
    currentPrice: '',
    supplier: '',
    barcode: '',
  });
  const [bulkText, setBulkText] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);

  // Pending Excel Upload Modal
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeMeta = CATEGORY_META[activeCategory];

  // Category counts & products in current category
  const categoryCounts: Record<ProductCategory, number> = {
    COSMETICS: 0,
    HEALTH_FOOD: 0,
    FOOD: 0,
  };
  for (const p of products) {
    const cat = normalizeCategory(p.category);
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  const categoryProducts = products.filter((p) => normalizeCategory(p.category) === activeCategory);

  // Summary counters for current category
  let foundCount = 0;
  let adjustNeededCount = 0;
  let checkRecommendedCount = 0;
  let unsearchedCount = 0;

  for (const p of categoryProducts) {
    const m = getBestOnlineMetrics(p, includeShipping);
    if (m.hasOnlinePrice) {
      foundCount++;
      if (m.isExpensive) adjustNeededCount++;
      if (p.matchConfidence === 'MEDIUM') checkRecommendedCount++;
    } else {
      unsearchedCount++;
    }
  }

  const suppliers = Array.from(new Set(categoryProducts.map((p) => p.supplier).filter(Boolean))) as string[];

  const filteredProducts = categoryProducts.filter((product) => {
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase();
      const matchesName = product.name.toLowerCase().includes(keyword);
      const matchesSpec = product.spec?.toLowerCase().includes(keyword);
      const matchesBarcode = product.barcode?.toLowerCase().includes(keyword);
      const matchesMatched = product.matchedTitle?.toLowerCase().includes(keyword);
      if (!matchesName && !matchesSpec && !matchesBarcode && !matchesMatched) return false;
    }

    if (filterSupplier !== 'ALL' && product.supplier !== filterSupplier) return false;

    const m = getBestOnlineMetrics(product, includeShipping);
    if (filterStatus === 'FOUND' && !m.hasOnlinePrice) return false;
    if (filterStatus === 'ADJUST_NEEDED' && !m.isExpensive) return false;
    if (filterStatus === 'CHECK_RECOMMENDED' && !(m.hasOnlinePrice && product.matchConfidence === 'MEDIUM')) return false;
    if (filterStatus === 'UNSEARCHED' && m.hasOnlinePrice) return false;

    return true;
  });

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (!sortConfig) return 0;

    let aValue: any;
    let bValue: any;

    if (sortConfig.key === 'diff') {
      aValue = getBestOnlineMetrics(a, includeShipping).diffAmount;
      bValue = getBestOnlineMetrics(b, includeShipping).diffAmount;
    } else {
      aValue = a[sortConfig.key];
      bValue = b[sortConfig.key];
    }

    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;

    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleCategoryChange = (nextCategory: ProductCategory) => {
    if (nextCategory === activeCategory) return;
    setActiveCategory(nextCategory);
    setSelectedIds([]);
    setFilterSupplier('ALL');
    setFilterStatus('ALL');
    setCurrentPage(1);
    setBatchSummary(null);
  };

  const handleSort = (key: SortKey) => {
    if (sortConfig && sortConfig.key === key) {
      if (sortConfig.direction === 'asc') {
        setSortConfig({ key, direction: 'desc' });
      } else {
        setSortConfig(null);
      }
    } else {
      setSortConfig({ key, direction: 'asc' });
    }
  };

  const renderSortIndicator = (key: SortKey) => {
    if (!sortConfig || sortConfig.key !== key)
      return <span style={{ color: 'var(--text-muted)', marginLeft: '4px', fontSize: '10px', fontWeight: 300 }}>⇅</span>;
    return sortConfig.direction === 'asc' ? (
      <span style={{ color: 'var(--text-color)', marginLeft: '4px', fontSize: '11px', fontWeight: 500 }}>↑</span>
    ) : (
      <span style={{ color: 'var(--text-color)', marginLeft: '4px', fontSize: '11px', fontWeight: 500 }}>↓</span>
    );
  };

  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    fetchProducts();

    const savedState = sessionStorage.getItem('searchAppState');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        if (parsed.activeCategory) setActiveCategory(normalizeCategory(parsed.activeCategory));
        if (parsed.filterStatus) setFilterStatus(parsed.filterStatus);
        if (parsed.filterSupplier) setFilterSupplier(parsed.filterSupplier);
        if (parsed.searchKeyword !== undefined) setSearchKeyword(parsed.searchKeyword);
        if (parsed.sortConfig !== undefined) setSortConfig(parsed.sortConfig);
        if (parsed.currentPage) setCurrentPage(parsed.currentPage);
        if (parsed.itemsPerPage) setItemsPerPage(parsed.itemsPerPage);
        if (parsed.includeShipping !== undefined) setIncludeShipping(parsed.includeShipping);
      } catch {}
    }
    setIsRestored(true);
  }, []);

  useEffect(() => {
    if (!isRestored) return;
    sessionStorage.setItem(
      'searchAppState',
      JSON.stringify({
        activeCategory,
        filterStatus,
        filterSupplier,
        searchKeyword,
        sortConfig,
        currentPage,
        itemsPerPage,
        includeShipping,
      })
    );
  }, [activeCategory, filterStatus, filterSupplier, searchKeyword, sortConfig, currentPage, itemsPerPage, includeShipping, isRestored]);

  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      if (data.products) {
        setProducts(data.products);
      }
    } catch (error) {
      console.error('Failed to fetch products', error);
    }
  };

  const openSessionWindow = async (channel: 'naver' | 'coupang') => {
    try {
      const res = await fetch('/api/session/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      if (data.success) {
        setBlockedChannels((prev) => prev.filter((c) => c !== channel));
      } else {
        alert(data.error || '세션 창을 열 수 없습니다.');
      }
    } catch {
      alert('세션 창 호출 중 오류가 발생했습니다.');
    }
  };

  const downloadDiagnostics = () => {
    const failedItems = categoryProducts.filter((p) => !getBestOnlineMetrics(p, includeShipping).hasOnlinePrice);
    if (failedItems.length === 0) {
      alert(`[${activeMeta.label}] 미검색 항목이 없습니다.`);
      return;
    }
    const textData = failedItems.map((p) => `${p.name} ${p.spec || ''}`.trim()).join('\n');
    const blob = new Blob([textData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `failed_items_${activeCategory.toLowerCase()}_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportToExcel = (onlyAdjustNeeded = false) => {
    let targetList = sortedProducts;
    if (onlyAdjustNeeded) {
      targetList = categoryProducts
        .filter((p) => getBestOnlineMetrics(p, includeShipping).isExpensive)
        .sort((a, b) => {
          const da = getBestOnlineMetrics(a, includeShipping).diffAmount ?? 0;
          const db = getBestOnlineMetrics(b, includeShipping).diffAmount ?? 0;
          return da - db; // Most overpriced first
        });
    }

    const data = targetList.map((p) => {
      const m = getBestOnlineMetrics(p, includeShipping);
      return {
        카테고리: CATEGORY_META[normalizeCategory(p.category)].label,
        상품명: p.name,
        규격: p.spec || '',
        공급사: p.supplier || '',
        '우리 판매가': p.currentPrice,
        '네이버 최저가': p.naverPrice ?? '-',
        '쿠팡 최저가': p.coupangPrice ?? '-',
        '오픈마켓 최저가': p.openMarketPrice ?? '-',
        '오픈마켓 판매처': p.openMarketMall || '',
        '최종 최저가': m.lowestPrice ?? '-',
        '최저가 채널': m.lowestLabel || '',
        '판매가 차액': m.diffAmount ?? '-',
        '차액(%)': m.diffPct !== null ? `${m.diffPct}%` : '-',
        '매칭 상품명': p.matchedTitle || '',
        신뢰도: p.matchConfidence === 'HIGH' ? '정확 일치' : p.matchConfidence === 'MEDIUM' ? p.matchNote || '확인 권장' : '-',
        '최저가 링크': m.lowestLink || '',
      };
    });

    if (data.length === 0) {
      alert(onlyAdjustNeeded ? '가격 조정이 필요한 항목이 없습니다.' : '출력할 데이터가 없습니다.');
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, onlyAdjustNeeded ? '가격조정리포트' : activeMeta.excelSheetName);
    const prefix = onlyAdjustNeeded ? `${activeMeta.exportPrefix}_adjust_report` : activeMeta.exportPrefix;
    XLSX.writeFile(workbook, `${prefix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const executeFileUpload = async (file: File, mode: 'replace' | 'append') => {
    setUploading(true);
    setPendingUploadFile(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', activeCategory);
    formData.append('mode', mode);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const contentType = res.headers.get('content-type');
      if (contentType && contentType.indexOf('application/json') !== -1) {
        const data = await res.json();
        if (data.success) {
          const actionText = mode === 'append' ? '추가' : '교체 업로드';
          alert(`[${activeMeta.label}] ${data.count}개의 상품을 성공적으로 ${actionText}했습니다.`);
          fetchProducts();
          setSelectedIds([]);
          setCurrentPage(1);
        } else {
          alert(data.error || '업로드에 실패했습니다.');
        }
      } else {
        alert('서버 오류가 발생했습니다. 개발자 도구 콘솔을 확인해주세요.');
      }
    } catch (error) {
      console.error(error);
      alert('업로드 중 네트워크 오류가 발생했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (categoryProducts.length > 0) {
      setPendingUploadFile(file);
      return;
    }
    await executeFileUpload(file, 'replace');
  };

  const openAddModal = () => {
    setAddForm({
      category: activeCategory,
      name: '',
      spec: '',
      currentPrice: '',
      supplier: '',
      barcode: '',
    });
    setBulkText('');
    setAddTab('single');
    setShowAddModal(true);
  };

  const parseBulkLines = (text: string, category: ProductCategory) => {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.includes('\t')
          ? line.split('\t')
          : line.includes('|')
            ? line.split('|')
            : line.split(',');

        const trimmed = parts.map((p) => p.trim());
        if (trimmed.length === 2) {
          const secondIsPrice = /^[0-9,원\s]+$/.test(trimmed[1]);
          return {
            category,
            name: trimmed[0],
            spec: secondIsPrice ? '' : trimmed[1],
            currentPrice: secondIsPrice ? trimmed[1] : '0',
            supplier: '',
          };
        }
        return {
          category,
          name: trimmed[0] || '',
          spec: trimmed[1] || '',
          currentPrice: trimmed[2] || '0',
          supplier: trimmed[3] || '',
        };
      })
      .filter((item) => item.name.length > 0);
  };

  const handleSaveManualAdd = async () => {
    setSavingAdd(true);
    try {
      let payload: any;
      if (addTab === 'single') {
        if (!addForm.name.trim()) {
          alert('상품명을 입력해주세요.');
          setSavingAdd(false);
          return;
        }
        payload = {
          category: addForm.category,
          name: addForm.name.trim(),
          spec: addForm.spec.trim(),
          currentPrice: addForm.currentPrice,
          supplier: addForm.supplier.trim(),
          barcode: addForm.barcode.trim(),
        };
      } else {
        const items = parseBulkLines(bulkText, addForm.category);
        if (items.length === 0) {
          alert('입력할 상품 내용을 1줄 이상 작성해주세요.');
          setSavingAdd(false);
          return;
        }
        payload = { category: addForm.category, items };
      }

      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success && data.products) {
        setProducts((prev) => [...data.products, ...prev]);
        setActiveCategory(addForm.category);
        setCurrentPage(1);
        setShowAddModal(false);
      } else {
        alert(data.error || '상품 추가에 실패했습니다.');
      }
    } catch (error) {
      console.error(error);
      alert('상품 추가 중 오류가 발생했습니다.');
    } finally {
      setSavingAdd(false);
    }
  };

  const checkPrice = async (
    productId: number,
    customKeyword?: string
  ): Promise<Product | null> => {
    setCheckingIds((prev) => new Set(prev).add(productId));
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, customKeyword, includeShipping }),
      });
      const data = await res.json();

      if (Array.isArray(data.blockedChannels) && data.blockedChannels.length > 0) {
        setBlockedChannels((prev) => Array.from(new Set([...prev, ...data.blockedChannels])));
      }

      if (data.success && data.product) {
        setProducts((prevProducts) => prevProducts.map((p) => (p.id === productId ? data.product : p)));

        if (customKeyword) {
          const m = getBestOnlineMetrics(data.product, includeShipping);
          if (!m.hasOnlinePrice) {
            alert('조건에 정확히 맞는 최저가를 찾지 못했습니다. 아래 유사 후보가 있다면 1클릭으로 확정하실 수 있습니다.');
          }
        }
        return data.product;
      }
      return null;
    } catch (error) {
      console.error(error);
      return null;
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }
  };

  /**
   * High-speed parallel worker pool (3 concurrent workers) with live stop/cancel & summary report.
   */
  const runBatchCompare = async (targets: Product[], label: string) => {
    const actionable = targets.filter((p) => !p.isManualOverride);
    if (actionable.length === 0) {
      alert('자동 조회할 대상 상품이 없습니다. (수동 고정된 항목 제외)');
      return;
    }

    stopRequestedRef.current = false;
    setLoading(true);
    setBatchSummary(null);
    setProgress({ current: 0, total: actionable.length, label });

    const CONCURRENCY = 3;
    let cursor = 0;
    let completed = 0;
    let matched = 0;
    let expensive = 0;

    const worker = async () => {
      while (!stopRequestedRef.current) {
        const idx = cursor++;
        if (idx >= actionable.length) break;

        const target = actionable[idx];
        const updated = await checkPrice(target.id);
        completed++;

        if (updated) {
          const m = getBestOnlineMetrics(updated, includeShipping);
          if (m.hasOnlinePrice) {
            matched++;
            if (m.isExpensive) expensive++;
          }
        }

        setProgress({ current: completed, total: actionable.length, label });
        await new Promise((r) => setTimeout(r, 150));
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, actionable.length) }, () => worker()));

    const stopped = stopRequestedRef.current;
    setLoading(false);
    setProgress(null);
    setBatchSummary(
      stopped
        ? `⏹ 사용자 요청으로 중지됨 (${completed}/${actionable.length}건 완료 · 최저가 발견 ${matched}건 · 가격 조정 필요 ${expensive}건)`
        : `✅ [${activeMeta.label}] ${label} 완료! 총 ${actionable.length}건 중 ${matched}건 최저가 확인 · 가격 조정 필요 ${expensive}건`
    );
  };

  const confirmRecommendation = async (product: Product, rec: RecommendedCandidate) => {
    const priceNum = parseInt(rec.lprice, 10);
    if (isNaN(priceNum)) return;

    const payload: Record<string, any> = {
      id: product.id,
      isManualOverride: true,
      matchedTitle: rec.title,
      matchConfidence: 'HIGH',
      matchNote: '실무자 1클릭 확정',
      candidateJson: null,
    };

    if (rec.channel === 'COUPANG') {
      payload.coupangPrice = priceNum;
      payload.coupangLink = rec.link;
      payload.coupangShipping = rec.shipping;
    } else if (rec.channel === 'NAVER') {
      payload.naverPrice = priceNum;
      payload.naverLink = rec.link;
      payload.naverShipping = rec.shipping;
    } else {
      payload.openMarketPrice = priceNum;
      payload.openMarketLink = rec.link;
      payload.openMarketMall = rec.mallName;
      payload.openMarketShipping = rec.shipping;
    }

    try {
      const res = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && data.product) {
        setProducts((prev) => prev.map((p) => (p.id === product.id ? data.product : p)));
        setExpandedRecIds((prev) => {
          const next = new Set(prev);
          next.delete(product.id);
          return next;
        });
      }
    } catch {
      alert('확정 저장 중 오류가 발생했습니다.');
    }
  };

  const formatPrice = (price?: number | null) => {
    if (price === null || price === undefined) return '-';
    return price.toLocaleString() + '원';
  };

  const renderShippingTag = (shipping?: number | null) => {
    if (shipping === null || shipping === undefined) return null;
    if (shipping === 0) return <span className="shipping-tag free">무료배송</span>;
    return <span className="shipping-tag">+{shipping.toLocaleString()}원</span>;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const toggleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedIds(sortedProducts.map((p) => p.id));
    else setSelectedIds([]);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`선택한 ${selectedIds.length}개의 항목을 정말 삭제하시겠습니까?`)) return;

    try {
      const res = await fetch('/api/products/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (data.success) {
        setProducts(products.filter((p) => !selectedIds.includes(p.id)));
        setSelectedIds([]);
      } else {
        alert(data.error || '삭제 실패');
      }
    } catch (error) {
      console.error(error);
      alert('삭제 중 오류 발생');
    }
  };

  const handleResetOverride = async () => {
    if (!editingProduct) return;
    if (!confirm('수동 고정을 해제하고 모든 조회 가격을 초기화하시겠습니까?')) return;

    setSavingEdit(true);
    try {
      const res = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingProduct.id,
          isManualOverride: false,
          naverPrice: '',
          naverLink: '',
          naverShipping: '',
          coupangPrice: '',
          coupangLink: '',
          coupangShipping: '',
          openMarketPrice: '',
          openMarketLink: '',
          openMarketMall: '',
          openMarketShipping: '',
          matchedTitle: '',
          matchConfidence: '',
          matchNote: '',
          candidateJson: '',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProducts(products.map((p) => (p.id === data.product.id ? data.product : p)));
        setEditingProduct(null);
      } else {
        alert('초기화에 실패했습니다.');
      }
    } catch {
      alert('오류가 발생했습니다.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleEditClick = (product: Product) => {
    setEditingProduct(product);
    setEditForm({
      category: normalizeCategory(product.category),
      currentPrice: product.currentPrice ? String(product.currentPrice) : '',
      naverPrice: product.naverPrice ? String(product.naverPrice) : '',
      naverLink: product.naverLink || '',
      coupangPrice: product.coupangPrice ? String(product.coupangPrice) : '',
      coupangLink: product.coupangLink || '',
      openMarketPrice: product.openMarketPrice ? String(product.openMarketPrice) : '',
      openMarketLink: product.openMarketLink || '',
      openMarketMall: product.openMarketMall || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingProduct) return;
    setSavingEdit(true);
    try {
      const res = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingProduct.id,
          category: editForm.category,
          currentPrice: editForm.currentPrice,
          naverPrice: editForm.naverPrice,
          naverLink: editForm.naverLink,
          coupangPrice: editForm.coupangPrice,
          coupangLink: editForm.coupangLink,
          openMarketPrice: editForm.openMarketPrice,
          openMarketLink: editForm.openMarketLink,
          openMarketMall: editForm.openMarketMall,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProducts(products.map((p) => (p.id === data.product.id ? data.product : p)));
        setEditingProduct(null);
      } else {
        alert(data.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="container">
      {/* Header */}
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <h1 className="title" style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          Search
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>v{packageJson.version}</span>
        </h1>
        <div className="upload-section" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={openAddModal}
            style={{ fontWeight: 500, borderColor: 'var(--text-color)' }}
          >
            + 상품 추가
          </button>
          <a href={`/api/template?category=${activeCategory}`} className="btn-secondary" style={{ textDecoration: 'none' }}>
            양식
          </a>
          <input
            type="file"
            accept=".xlsx, .xls"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="file-input"
            id="excel-upload"
          />
          <label htmlFor="excel-upload" className="btn-secondary" style={{ cursor: 'pointer' }}>
            {uploading ? '업로드 중...' : '엑셀 업로드'}
          </label>
          <button
            className="btn-secondary"
            onClick={() => setShowSettings(true)}
            title="네이버/쿠팡 세션 연결 및 진단"
          >
            🔐 세션/설정
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              const selectedTargets =
                selectedIds.length > 0
                  ? categoryProducts.filter((p) => selectedIds.includes(p.id))
                  : categoryProducts;
              runBatchCompare(
                selectedTargets,
                selectedIds.length > 0 ? `선택 ${selectedTargets.length}건 비교` : '전체 비교'
              );
            }}
            disabled={loading || categoryProducts.length === 0}
            style={{ minWidth: '165px', fontWeight: 600 }}
          >
            {loading && progress
              ? `조회 중 (${progress.current}/${progress.total})`
              : selectedIds.length > 0
                ? `⚡ 선택 ${selectedIds.length}건 원클릭 비교`
                : `⚡ ${activeMeta.shortLabel} 원클릭 전체 비교`}
          </button>
          {unsearchedCount > 0 && !loading && (
            <button
              className="btn-secondary"
              onClick={() =>
                runBatchCompare(
                  categoryProducts.filter((p) => !getBestOnlineMetrics(p, includeShipping).hasOnlinePrice),
                  '미검색 재시도'
                )
              }
              style={{ borderColor: '#f59e0b', color: '#b45309', backgroundColor: '#fffbeb', fontWeight: 500 }}
            >
              🔄 미검색 재시도 ({unsearchedCount})
            </button>
          )}
          {selectedIds.length > 0 && (
            <>
              <a
                href={`/verify?ids=${selectedIds.join(',')}`}
                className="btn-secondary"
                style={{ textDecoration: 'none', backgroundColor: '#fffbe1', borderColor: '#fef08a', color: '#a16207', fontWeight: 600 }}
              >
                2차 검증 ({selectedIds.length})
              </a>
              <button
                className="btn-secondary"
                onClick={deleteSelected}
                style={{ color: 'white', backgroundColor: '#e11d48', borderColor: '#e11d48' }}
              >
                삭제 ({selectedIds.length})
              </button>
            </>
          )}
        </div>
      </header>

      {/* Category Tabs */}
      <div className="category-bar">
        <div className="category-tabs" role="tablist" aria-label="상품 카테고리">
          {CATEGORY_LIST.map((catId) => {
            const meta = CATEGORY_META[catId];
            const isActive = activeCategory === catId;
            return (
              <button
                key={catId}
                role="tab"
                aria-selected={isActive}
                className={`category-tab ${isActive ? 'active' : ''}`}
                onClick={() => handleCategoryChange(catId)}
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
                <span className="category-count">{categoryCounts[catId]}</span>
              </button>
            );
          })}
        </div>
        <div className="category-hint">
          네이버 · 쿠팡 · 오픈마켓(G마켓·11번가·옥션·롯데ON) 3채널 자동 비교 | {activeMeta.description}
        </div>
      </div>

      {/* Blocked Session Helper Banner (only shown if Naver/Coupang requests human check) */}
      {blockedChannels.length > 0 && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            backgroundColor: '#fffbeb',
            border: '1px solid #fcd34d',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: '0.84rem', color: '#92400e' }}>
            <b>🔐 보안 확인 안내:</b>{' '}
            {blockedChannels.map((c) => (c === 'naver' ? '네이버 쇼핑' : '쿠팡')).join(', ')}에서 본인 확인(로그인/보안문자)을 요청했습니다.
            오른쪽 버튼으로 창을 열어 1회만 확인해 두시면 세션이 유지되어 자동으로 이어서 조회됩니다. *(오픈마켓 가격은 정상 조회됨)*
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {blockedChannels.includes('naver') && (
              <button className="btn-secondary btn-small" onClick={() => openSessionWindow('naver')} style={{ fontWeight: 600 }}>
                네이버 세션 열기
              </button>
            )}
            {blockedChannels.includes('coupang') && (
              <button className="btn-secondary btn-small" onClick={() => openSessionWindow('coupang')} style={{ fontWeight: 600 }}>
                쿠팡 세션 열기
              </button>
            )}
            <button
              className="btn-secondary btn-small"
              onClick={() => setBlockedChannels([])}
              style={{ color: '#64748b' }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Active Batch Progress Bar with Stop Button */}
      {loading && progress && (
        <div style={{ marginBottom: '1rem', padding: '0.9rem 1rem', backgroundColor: '#fafafa', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
            <span>
              <b>[{activeMeta.label}]</b> {progress.label} 진행 중... (3채널 고속 병렬 탐색)
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontWeight: 600 }}>
                {Math.round((progress.current / progress.total) * 100)}% ({progress.current} / {progress.total})
              </span>
              <button
                className="btn-secondary btn-small"
                onClick={() => {
                  stopRequestedRef.current = true;
                }}
                style={{ color: '#e11d48', borderColor: '#fda4af', backgroundColor: '#fff1f2', fontWeight: 600 }}
              >
                ⏹ 중지
              </button>
            </div>
          </div>
          <div style={{ width: '100%', height: '8px', backgroundColor: '#e5e5e5', overflow: 'hidden' }}>
            <div
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
                height: '100%',
                backgroundColor: 'var(--primary)',
                transition: 'width 0.25s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* Batch Completion Summary Banner */}
      {batchSummary && !loading && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.7rem 1rem',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.85rem',
            color: '#166534',
          }}
        >
          <span>{batchSummary}</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {adjustNeededCount > 0 && (
              <button
                className="btn-secondary btn-small"
                onClick={() => {
                  setFilterStatus('ADJUST_NEEDED');
                  setSortConfig({ key: 'diff', direction: 'asc' });
                  setCurrentPage(1);
                }}
                style={{ borderColor: '#16a34a', color: '#15803d', fontWeight: 600 }}
              >
                조정 필요 항목만 보기 ({adjustNeededCount})
              </button>
            )}
            <button className="btn-secondary btn-small" onClick={() => setBatchSummary(null)}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Clickable Summary Dashboard Cards */}
      <div className="summary-grid">
        <button
          className={`summary-card ${filterStatus === 'ALL' ? 'active' : ''}`}
          onClick={() => { setFilterStatus('ALL'); setCurrentPage(1); }}
        >
          <span className="summary-card-label">전체 상품</span>
          <span className="summary-card-value">{categoryProducts.length}</span>
        </button>
        <button
          className={`summary-card ${filterStatus === 'FOUND' ? 'active' : ''}`}
          onClick={() => { setFilterStatus('FOUND'); setCurrentPage(1); }}
        >
          <span className="summary-card-label">✅ 최저가 확인됨</span>
          <span className="summary-card-value" style={{ color: '#059669' }}>{foundCount}</span>
        </button>
        <button
          className={`summary-card ${filterStatus === 'ADJUST_NEEDED' ? 'active' : ''}`}
          onClick={() => {
            setFilterStatus('ADJUST_NEEDED');
            setSortConfig({ key: 'diff', direction: 'asc' });
            setCurrentPage(1);
          }}
        >
          <span className="summary-card-label">🔴 가격 조정 필요</span>
          <span className="summary-card-value" style={{ color: '#e11d48' }}>{adjustNeededCount}</span>
        </button>
        <button
          className={`summary-card ${filterStatus === 'CHECK_RECOMMENDED' ? 'active' : ''}`}
          onClick={() => { setFilterStatus('CHECK_RECOMMENDED'); setCurrentPage(1); }}
        >
          <span className="summary-card-label">🟡 옵션/맛 확인 권장</span>
          <span className="summary-card-value" style={{ color: '#d97706' }}>{checkRecommendedCount}</span>
        </button>
        <button
          className={`summary-card ${filterStatus === 'UNSEARCHED' ? 'active' : ''}`}
          onClick={() => { setFilterStatus('UNSEARCHED'); setCurrentPage(1); }}
        >
          <span className="summary-card-label">⚠️ 미검색</span>
          <span className="summary-card-value" style={{ color: '#64748b' }}>{unsearchedCount}</span>
        </button>
      </div>

      {/* Filter & Export Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="search-input"
              placeholder={activeMeta.searchPlaceholder}
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                padding: '0.4rem 0.75rem',
                paddingLeft: '2rem',
                border: '1px solid var(--border)',
                fontSize: '0.85rem',
                width: '230px',
                outline: 'none',
                fontFamily: 'inherit',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)',
              }}
            />
            <span style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              ⌕
            </span>
          </div>

          <select
            value={filterSupplier}
            onChange={(e) => {
              setFilterSupplier(e.target.value);
              setCurrentPage(1);
            }}
            style={{ padding: '0.4rem', fontSize: '0.85rem', border: '1px solid var(--border)' }}
          >
            <option value="ALL">전체 공급사</option>
            {suppliers.map((sup) => (
              <option key={sup} value={sup}>
                {sup}
              </option>
            ))}
          </select>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.83rem',
              cursor: 'pointer',
              padding: '0.38rem 0.65rem',
              border: '1px solid var(--border)',
              backgroundColor: includeShipping ? '#f8fafc' : '#fff',
              fontWeight: includeShipping ? 600 : 400,
            }}
            title="체크 시 각 채널의 배송비를 더한 실구매가 기준으로 최저가와 차액을 비교합니다."
          >
            <input
              type="checkbox"
              checked={includeShipping}
              onChange={(e) => setIncludeShipping(e.target.checked)}
            />
            배송비 포함 비교
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={() => exportToExcel(true)}
            style={{ fontSize: '0.82rem', padding: '0.35rem 0.7rem', borderColor: '#e11d48', color: '#e11d48', fontWeight: 500 }}
          >
            📊 조정 리포트 저장 ({adjustNeededCount})
          </button>
          <button
            className="btn-secondary"
            onClick={() => exportToExcel(false)}
            style={{ fontSize: '0.82rem', padding: '0.35rem 0.7rem' }}
          >
            전체 엑셀 저장
          </button>
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            style={{ padding: '0.35rem', fontSize: '0.82rem', border: '1px solid var(--border)' }}
          >
            <option value={10}>10개씩</option>
            <option value={20}>20개씩</option>
            <option value={50}>50개씩</option>
            <option value={100}>100개씩</option>
            <option value={filteredProducts.length > 0 ? filteredProducts.length : 1000}>전체보기</option>
          </select>
        </div>
      </div>

      {/* Main 3-Channel Table */}
      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc' }}>
                <th style={{ width: '38px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    onChange={toggleSelectAll}
                    checked={sortedProducts.length > 0 && selectedIds.length === sortedProducts.length}
                  />
                </th>
                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  상품명 & 매칭 근거{renderSortIndicator('name')}
                </th>
                <th onClick={() => handleSort('currentPrice')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  우리 판매가{renderSortIndicator('currentPrice')}
                </th>
                <th onClick={() => handleSort('naverPrice')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  네이버 최저가{renderSortIndicator('naverPrice')}
                </th>
                <th onClick={() => handleSort('coupangPrice')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  쿠팡 최저가{renderSortIndicator('coupangPrice')}
                </th>
                <th onClick={() => handleSort('openMarketPrice')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  오픈마켓 최저가{renderSortIndicator('openMarketPrice')}
                </th>
                <th onClick={() => handleSort('diff')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  최저가 차액 / 상태{renderSortIndicator('diff')}
                </th>
                <th style={{ whiteSpace: 'nowrap' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {sortedProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                    {categoryProducts.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <div>
                          등록된 <b>{activeMeta.label}</b> 상품이 없습니다. 엑셀을 업로드하거나 직접 추가해주세요.
                        </div>
                        <button className="btn-primary" onClick={openAddModal}>
                          + {activeMeta.shortLabel} 상품 직접 추가하기
                        </button>
                      </div>
                    ) : (
                      '현재 필터 조건에 맞는 상품이 없습니다.'
                    )}
                  </td>
                </tr>
              ) : (
                sortedProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((product) => {
                  const metrics = getBestOnlineMetrics(product, includeShipping);
                  const recommendations = !metrics.hasOnlinePrice ? parseRecommendations(product.candidateJson) : [];
                  const isRecOpen = expandedRecIds.has(product.id);

                  const nEff = getEffectiveChannelPrice(product.naverPrice, product.naverShipping, includeShipping);
                  const cEff = getEffectiveChannelPrice(product.coupangPrice, product.coupangShipping, includeShipping);
                  const oEff = getEffectiveChannelPrice(product.openMarketPrice, product.openMarketShipping, includeShipping);

                  return (
                    <tr key={product.id}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(product.id)}
                          onChange={() => toggleSelect(product.id)}
                        />
                      </td>
                      <td style={{ minWidth: '250px' }}>
                        <div style={{ fontWeight: 500 }}>
                          {product.name}
                          {product.spec && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82em', marginLeft: '5px' }}>{product.spec}</span>
                          )}
                        </div>
                        {product.supplier && (
                          <div style={{ color: '#8b5cf6', fontSize: '0.73rem', marginTop: '2px' }}>{product.supplier}</div>
                        )}

                        {/* Transparent Match Evidence (no need to open external links!) */}
                        {product.matchedTitle && (
                          <div className="matched-meta">
                            {product.matchConfidence === 'HIGH' ? (
                              <span className="pill-confidence-high">🟢 정확 일치</span>
                            ) : (
                              <span className="pill-confidence-med" title={product.matchNote || '확인 권장'}>
                                🟡 {product.matchNote || '확인 권장'}
                              </span>
                            )}
                            <span className="matched-title-text" title={product.matchedTitle}>
                              매칭: {product.matchedTitle}
                            </span>
                          </div>
                        )}

                        {/* Inline 1-Click Recommendation Drawer for Unmatched Items */}
                        {recommendations.length > 0 && (
                          <div style={{ marginTop: '6px' }}>
                            <button
                              type="button"
                              className="btn-secondary btn-small"
                              style={{ fontSize: '0.72rem', padding: '2px 7px', borderColor: '#cbd5e1', color: '#334155' }}
                              onClick={() => {
                                setExpandedRecIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(product.id)) next.delete(product.id);
                                  else next.add(product.id);
                                  return next;
                                });
                              }}
                            >
                              💡 유사 후보 {recommendations.length}건 {isRecOpen ? '접기 ▲' : '바로 확정 ▼'}
                            </button>
                            {isRecOpen && (
                              <div className="rec-box">
                                {recommendations.map((rec, i) => (
                                  <div key={i} className="rec-item">
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={rec.title}>
                                        <span className="mall-tag" style={{ marginRight: '5px' }}>{rec.mallName}</span>
                                        {rec.title}
                                      </div>
                                      <div style={{ color: '#475569', marginTop: '2px' }}>
                                        <b>{Number(rec.lprice).toLocaleString()}원</b>{' '}
                                        {renderShippingTag(rec.shipping)}
                                        <a href={rec.link} target="_blank" rel="noreferrer" style={{ marginLeft: '8px', fontSize: '0.7rem' }}>
                                          보기
                                        </a>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn-primary btn-small"
                                      style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}
                                      onClick={() => confirmRecommendation(product, rec)}
                                    >
                                      확정
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Current Selling Price */}
                      <td className="price" style={{ whiteSpace: 'nowrap' }}>
                        {product.currentPrice > 0 ? formatPrice(product.currentPrice) : <span style={{ color: '#94a3b8' }}>미입력</span>}
                      </td>

                      {/* Channel 1: Naver */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span className={`price ${nEff !== null && product.currentPrice > 0 && product.currentPrice > nEff ? 'price-expensive' : ''}`}>
                            {formatPrice(nEff)}
                          </span>
                          {renderShippingTag(product.naverShipping)}
                          {product.naverLink ? (
                            <a href={product.naverLink} target="_blank" rel="noreferrer" className="link-icon">
                              🔗 바로가기
                            </a>
                          ) : (
                            <a
                              href={`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(
                                product.spec ? `${product.name} ${product.spec}` : product.name
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              className="link-icon"
                              style={{ opacity: 0.7 }}
                            >
                              🔎 직접보기
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Channel 2: Coupang */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span className={`price ${cEff !== null && product.currentPrice > 0 && product.currentPrice > cEff ? 'price-expensive' : ''}`}>
                            {formatPrice(cEff)}
                          </span>
                          {renderShippingTag(product.coupangShipping)}
                          {product.coupangLink ? (
                            <a href={product.coupangLink} target="_blank" rel="noreferrer" className="link-icon">
                              🔗 바로가기
                            </a>
                          ) : (
                            <a
                              href={`https://www.coupang.com/np/search?q=${encodeURIComponent(
                                product.spec ? `${product.name} ${product.spec}` : product.name
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              className="link-icon"
                              style={{ opacity: 0.7 }}
                            >
                              🔎 직접보기
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Channel 3: Open Market (Gmarket / 11st / Auction / LotteON / Enuri / Danawa) */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span className={`price ${oEff !== null && product.currentPrice > 0 && product.currentPrice > oEff ? 'price-expensive' : ''}`}>
                            {formatPrice(oEff)}
                          </span>
                          {product.openMarketMall && <span className="mall-tag">{product.openMarketMall}</span>}
                          {renderShippingTag(product.openMarketShipping)}
                          {product.openMarketLink && (
                            <a href={product.openMarketLink} target="_blank" rel="noreferrer" className="link-icon">
                              🔗 바로가기
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Diff & Status */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', textAlign: 'center' }}>
                          {checkingIds.has(product.id) ? (
                            <span className="badge" style={{ backgroundColor: '#e0e7ff', color: '#4338ca', fontWeight: 600 }}>
                              🔍 3채널 탐색 중...
                            </span>
                          ) : metrics.hasOnlinePrice ? (
                            <>
                              {metrics.isExpensive ? (
                                <span className="badge badge-red">가격 조정 필요</span>
                              ) : (
                                <span className="badge badge-green">적정가</span>
                              )}
                              {metrics.diffAmount !== null && (
                                <span className={metrics.diffAmount < 0 ? 'diff-expensive' : 'diff-cheaper'}>
                                  {metrics.diffAmount < 0
                                    ? `${metrics.diffAmount.toLocaleString()}원 (${metrics.diffPct}%)`
                                    : `+${metrics.diffAmount.toLocaleString()}원`}
                                </span>
                              )}
                              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                최저: {metrics.lowestLabel}
                              </span>
                            </>
                          ) : (
                            <span className="badge" style={{ backgroundColor: '#f1f5f9', color: '#64748b' }}>미검색</span>
                          )}

                          {product.lastCheckedAt && !checkingIds.has(product.id) && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {formatDate(product.lastCheckedAt)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <button
                            className="btn-secondary btn-small"
                            onClick={() => checkPrice(product.id)}
                            disabled={checkingIds.has(product.id) || loading || product.isManualOverride}
                            style={{ minWidth: '72px', opacity: product.isManualOverride ? 0.6 : 1 }}
                          >
                            {checkingIds.has(product.id) ? '조회 중...' : product.isManualOverride ? '🔒 고정' : '가격 확인'}
                          </button>

                          <button
                            className="btn-secondary btn-small"
                            onClick={() =>
                              setTuningProduct({
                                id: product.id,
                                name: product.name,
                                keyword: product.spec ? `${product.name} ${product.spec}` : product.name,
                              })
                            }
                            disabled={checkingIds.has(product.id) || loading || product.isManualOverride}
                            style={{ minWidth: '72px', padding: '3px', fontSize: '0.72rem', backgroundColor: '#f8fafc' }}
                          >
                            키워드 수정
                          </button>

                          <button
                            className="btn-secondary btn-small"
                            onClick={() => handleEditClick(product)}
                            style={{ minWidth: '72px', padding: '3px', fontSize: '0.72rem' }}
                          >
                            수기 입력
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {sortedProducts.length > 0 && itemsPerPage < sortedProducts.length && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem', gap: '1rem', borderTop: '1px solid var(--border)' }}>
            <button
              className="btn-secondary btn-small"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              이전
            </button>
            <span style={{ fontSize: '0.85rem' }}>
              {currentPage} / {Math.ceil(sortedProducts.length / itemsPerPage)} 페이지
            </span>
            <button
              className="btn-secondary btn-small"
              onClick={() => setCurrentPage((p) => Math.min(Math.ceil(sortedProducts.length / itemsPerPage), p + 1))}
              disabled={currentPage === Math.ceil(sortedProducts.length / itemsPerPage)}
            >
              다음
            </button>
          </div>
        )}
      </div>

      {/* Upload Mode Choice Modal */}
      {pendingUploadFile && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => {
            setPendingUploadFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        >
          <div
            style={{ background: '#fff', padding: '24px', width: '420px', maxWidth: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '12px', fontSize: '1.15rem', fontWeight: 600 }}>
              {activeMeta.icon} {activeMeta.label} 엑셀 업로드 방식 선택
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.5, marginBottom: '16px' }}>
              현재 <b>{activeMeta.label}</b> 탭에 <b>{categoryProducts.length}개</b>의 상품이 등록되어 있습니다.<br />
              선택한 파일: <code style={{ background: '#f1f5f9', padding: '2px 5px' }}>{pendingUploadFile.name}</code>
            </p>
            <div style={{ fontSize: '0.78rem', color: '#0f766e', background: '#f0fdfa', border: '1px solid #ccfbf1', padding: '8px 10px', marginBottom: '18px' }}>
              다른 카테고리 탭의 상품 데이터는 영향을 받지 않고 안전하게 유지됩니다.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button className="btn-primary" onClick={() => executeFileUpload(pendingUploadFile, 'append')} style={{ padding: '10px' }}>
                기존 {activeMeta.shortLabel} 목록에 추가하기 (추천)
              </button>
              <button
                className="btn-secondary"
                onClick={() => executeFileUpload(pendingUploadFile, 'replace')}
                style={{ padding: '10px', color: '#e11d48', borderColor: '#fecdd3', backgroundColor: '#fff1f2' }}
              >
                기존 {activeMeta.shortLabel} 목록 비우고 새로 교체하기
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setPendingUploadFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                style={{ padding: '8px', color: '#64748b' }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Product Add Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => !savingAdd && setShowAddModal(false)}
        >
          <div
            style={{ background: '#fff', padding: '24px', width: '500px', maxWidth: '92%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '14px', fontSize: '1.2rem', fontWeight: 600 }}>상품 직접 추가</h2>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                저장할 카테고리
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {CATEGORY_LIST.map((catId) => {
                  const meta = CATEGORY_META[catId];
                  const selected = addForm.category === catId;
                  return (
                    <button
                      key={catId}
                      type="button"
                      onClick={() => setAddForm({ ...addForm, category: catId })}
                      style={{
                        flex: 1,
                        padding: '8px 6px',
                        fontSize: '0.85rem',
                        fontWeight: selected ? 600 : 400,
                        border: `1px solid ${selected ? '#000' : 'var(--border)'}`,
                        backgroundColor: selected ? '#000' : '#fff',
                        color: selected ? '#fff' : 'var(--text-color)',
                      }}
                    >
                      {meta.icon} {meta.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '16px' }}>
              <button
                type="button"
                onClick={() => setAddTab('single')}
                style={{
                  flex: 1,
                  padding: '8px',
                  fontSize: '0.85rem',
                  fontWeight: addTab === 'single' ? 600 : 400,
                  background: 'transparent',
                  borderBottom: addTab === 'single' ? '2px solid #000' : '2px solid transparent',
                  color: addTab === 'single' ? '#000' : 'var(--text-muted)',
                }}
              >
                개별 입력 (1개)
              </button>
              <button
                type="button"
                onClick={() => setAddTab('bulk')}
                style={{
                  flex: 1,
                  padding: '8px',
                  fontSize: '0.85rem',
                  fontWeight: addTab === 'bulk' ? 600 : 400,
                  background: 'transparent',
                  borderBottom: addTab === 'bulk' ? '2px solid #000' : '2px solid transparent',
                  color: addTab === 'bulk' ? '#000' : 'var(--text-muted)',
                }}
              >
                여러 줄 붙여넣기 (다건)
              </button>
            </div>

            {addTab === 'single' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '18px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', fontWeight: 500 }}>
                    상품명 <span style={{ color: '#e11d48' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={addForm.name}
                    onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                    placeholder={CATEGORY_META[addForm.category].namePlaceholder}
                    className="search-input"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                    autoFocus
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', fontWeight: 500 }}>
                      규격 / 용량 / 수량
                    </label>
                    <input
                      type="text"
                      value={addForm.spec}
                      onChange={(e) => setAddForm({ ...addForm, spec: e.target.value })}
                      placeholder={CATEGORY_META[addForm.category].specPlaceholder}
                      className="search-input"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', fontWeight: 500 }}>
                      우리 판매가 (원)
                    </label>
                    <input
                      type="number"
                      value={addForm.currentPrice}
                      onChange={(e) => setAddForm({ ...addForm, currentPrice: e.target.value })}
                      placeholder="예: 15900"
                      className="search-input"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--text-muted)' }}>
                      공급사 (선택)
                    </label>
                    <input
                      type="text"
                      value={addForm.supplier}
                      onChange={(e) => setAddForm({ ...addForm, supplier: e.target.value })}
                      placeholder="예: 종근당건강"
                      className="search-input"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--text-muted)' }}>
                      바코드 (선택)
                    </label>
                    <input
                      type="text"
                      value={addForm.barcode}
                      onChange={(e) => setAddForm({ ...addForm, barcode: e.target.value })}
                      placeholder="880..."
                      className="search-input"
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: '18px' }}>
                <p style={{ fontSize: '0.8rem', color: '#475569', marginTop: 0, marginBottom: '8px', lineHeight: 1.5 }}>
                  한 줄에 1개씩 입력하세요. 엑셀에서 복사(탭 구분)하거나 <b>쉼표(,)</b> 또는 <b>|</b>로 구분할 수 있습니다.<br />
                  형식: <code>상품명, 규격, 판매가, 공급사(선택)</code>
                </p>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={7}
                  placeholder={
                    addForm.category === 'HEALTH_FOOD'
                      ? '종근당건강 락토핏 골드, 50포, 13900, 종근당건강\n고려은단 비타민C 1000, 120정, 15500, 고려은단'
                      : addForm.category === 'FOOD'
                        ? '아이배냇 베베 핑거요거트, 20g, 5500, 아이배냇\n동원 라이트스탠다드 참치, 85g 12캔, 18900, 동원F&B'
                        : '토니모리 프리미엄RX 제비집 아이크림, 70ml, 29000, 토니모리'
                  }
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid var(--border)',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                  autoFocus
                />
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  인식된 상품 수: <b>{parseBulkLines(bulkText, addForm.category).length}개</b>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setShowAddModal(false)} disabled={savingAdd}>
                취소
              </button>
              <button className="btn-primary" onClick={handleSaveManualAdd} disabled={savingAdd}>
                {savingAdd ? '추가 중...' : '등록하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingProduct && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => !savingEdit && setEditingProduct(null)}
        >
          <div
            style={{ background: '#fff', padding: '24px', width: '430px', maxWidth: '92%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '1.2rem', fontWeight: 600 }}>가격 및 링크 수기 입력</h2>
            <div style={{ maxHeight: '62vh', overflowY: 'auto', paddingRight: '6px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>카테고리</label>
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: normalizeCategory(e.target.value) })}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid var(--border)', fontSize: '0.85rem' }}
                >
                  {CATEGORY_LIST.map((catId) => (
                    <option key={catId} value={catId}>
                      {CATEGORY_META[catId].icon} {CATEGORY_META[catId].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>우리 판매가</label>
                <input
                  type="number"
                  value={editForm.currentPrice}
                  onChange={(e) => setEditForm({ ...editForm, currentPrice: e.target.value })}
                  placeholder="숫자만 입력"
                  className="search-input"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>네이버 최저가</label>
                  <input
                    type="number"
                    value={editForm.naverPrice}
                    onChange={(e) => setEditForm({ ...editForm, naverPrice: e.target.value })}
                    className="search-input"
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>쿠팡 최저가</label>
                  <input
                    type="number"
                    value={editForm.coupangPrice}
                    onChange={(e) => setEditForm({ ...editForm, coupangPrice: e.target.value })}
                    className="search-input"
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>네이버 링크</label>
                <input
                  type="text"
                  value={editForm.naverLink}
                  onChange={(e) => setEditForm({ ...editForm, naverLink: e.target.value })}
                  placeholder="https://..."
                  className="search-input"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>쿠팡 링크</label>
                <input
                  type="text"
                  value={editForm.coupangLink}
                  onChange={(e) => setEditForm({ ...editForm, coupangLink: e.target.value })}
                  placeholder="https://..."
                  className="search-input"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>오픈마켓 최저가</label>
                  <input
                    type="number"
                    value={editForm.openMarketPrice}
                    onChange={(e) => setEditForm({ ...editForm, openMarketPrice: e.target.value })}
                    className="search-input"
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>판매처 (G마켓 등)</label>
                  <input
                    type="text"
                    value={editForm.openMarketMall}
                    onChange={(e) => setEditForm({ ...editForm, openMarketMall: e.target.value })}
                    placeholder="G마켓, 11번가..."
                    className="search-input"
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>오픈마켓 링크</label>
                <input
                  type="text"
                  value={editForm.openMarketLink}
                  onChange={(e) => setEditForm({ ...editForm, openMarketLink: e.target.value })}
                  placeholder="https://..."
                  className="search-input"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)' }}
                />
              </div>
            </div>

            <div style={{ fontSize: '12px', color: '#64748b', margin: '14px 0', background: '#f1f5f9', padding: '8px' }}>
              ℹ️ 저장 시 <b>[🔒 수동 고정]</b> 상태가 되어 일괄 조회에서 덮어쓰지 않습니다.
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="btn-secondary"
                onClick={handleResetOverride}
                disabled={savingEdit}
                style={{ marginRight: 'auto', color: '#ef4444', borderColor: '#fca5a5', backgroundColor: '#fef2f2' }}
              >
                🔓 초기화
              </button>
              <button className="btn-secondary" onClick={() => setEditingProduct(null)} disabled={savingEdit}>
                취소
              </button>
              <button className="btn-primary" onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tuning Modal */}
      {tuningProduct && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => setTuningProduct(null)}
        >
          <div
            style={{ background: '#fff', padding: '24px', width: '400px', maxWidth: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '12px', fontSize: '1.15rem', fontWeight: 600 }}>검색 키워드 수정 재조회</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
              자동 4단계 정제 이후에도 못 찾은 경우, 핵심 브랜드 + 상품명 + 규격만 남겨서 다시 조회해보세요.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <input
                type="text"
                value={tuningProduct.keyword}
                onChange={(e) => setTuningProduct({ ...tuningProduct, keyword: e.target.value })}
                className="search-input"
                style={{ width: '100%', padding: '10px', fontSize: '0.92rem', border: '1px solid var(--border)' }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tuningProduct.keyword.trim() !== '') {
                    checkPrice(tuningProduct.id, tuningProduct.keyword.trim());
                    setTuningProduct(null);
                  }
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setTuningProduct(null)}>취소</button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (tuningProduct.keyword.trim() !== '') {
                    checkPrice(tuningProduct.id, tuningProduct.keyword.trim());
                    setTuningProduct(null);
                  }
                }}
              >
                재조회
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session & Settings Modal */}
      {showSettings && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => setShowSettings(false)}
        >
          <div
            style={{ backgroundColor: 'white', padding: '1.75rem', width: '440px', maxWidth: '92%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.2rem' }}>🔐 3채널 세션 연결 및 진단</h2>

            <div style={{ fontSize: '0.82rem', color: '#0f766e', backgroundColor: '#f0fdfa', border: '1px solid #ccfbf1', padding: '10px 12px', marginBottom: '1.2rem', lineHeight: 1.55 }}>
              <b>오픈마켓(에누리·G마켓·11번가·옥션·롯데ON·다나와)</b>은 별도 설정 없이 즉시 자동 조회됩니다.<br />
              <b>네이버 쇼핑 · 쿠팡</b>은 앱 내 영구 세션에 1회만 로그인/확인해 두시면 원클릭 조회 성공률이 크게 높아집니다.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.25rem' }}>
              <button
                className="btn-secondary"
                onClick={() => openSessionWindow('naver')}
                style={{ padding: '10px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 500 }}
              >
                <span>🟢 네이버 쇼핑 세션 연결 창 열기</span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>로그인/확인 →</span>
              </button>
              <button
                className="btn-secondary"
                onClick={() => openSessionWindow('coupang')}
                style={{ padding: '10px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 500 }}
              >
                <span>🔴 쿠팡 세션 연결 창 열기</span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>로그인/확인 →</span>
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <button
                className="btn-secondary"
                onClick={downloadDiagnostics}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', backgroundColor: '#f1f5f9' }}
              >
                📥 미검색 목록 추출 ({activeMeta.shortLabel})
              </button>
              <button className="btn-primary" onClick={() => setShowSettings(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
