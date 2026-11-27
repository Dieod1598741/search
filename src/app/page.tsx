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

type Product = {
  id: number;
  name: string;
  spec?: string;
  barcode?: string;
  category?: ProductCategory;
  currentPrice: number;
  naverPrice?: number;
  naverLink?: string;
  coupangPrice?: number;
  coupangLink?: string;
  supplier?: string;
  lastCheckedAt?: string;
  isManualOverride?: boolean;
};

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Active Category Tab
  const [activeCategory, setActiveCategory] = useState<ProductCategory>('COSMETICS');

  // Progress & Loading states
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());
  const [activeSearches, setActiveSearches] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  // Settings states
  const [showSettings, setShowSettings] = useState(false);
  const [naverClientId, setNaverClientId] = useState('');
  const [naverClientSecret, setNaverClientSecret] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // Filter states
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ADJUST_NEEDED' | 'UNSEARCHED'>('ALL');
  const [filterSupplier, setFilterSupplier] = useState<string>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  // Sort states
  type SortKey = 'name' | 'currentPrice' | 'naverPrice' | 'coupangPrice';
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Edit states
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({
    category: 'COSMETICS' as ProductCategory,
    currentPrice: '',
    naverPrice: '',
    naverLink: '',
    coupangPrice: '',
    coupangLink: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [copyAlertProduct, setCopyAlertProduct] = useState<{ name: string; searchKeyword: string } | null>(null);
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

  // Pending Excel Upload Modal (when current category already has items)
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

  // Derived states (scoped to current category)
  const suppliers = Array.from(new Set(categoryProducts.map((p) => p.supplier).filter(Boolean))) as string[];

  const filteredProducts = categoryProducts.filter((product) => {
    // 0. Keyword filter
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase();
      const matchesName = product.name.toLowerCase().includes(keyword);
      const matchesSpec = product.spec?.toLowerCase().includes(keyword);
      const matchesBarcode = product.barcode?.toLowerCase().includes(keyword);
      if (!matchesName && !matchesSpec && !matchesBarcode) return false;
    }

    // 1. Supplier filter
    if (filterSupplier !== 'ALL' && product.supplier !== filterSupplier) return false;

    // 2. Status filter
    if (filterStatus === 'ADJUST_NEEDED') {
      const hasNaverPrice = product.naverPrice !== null && product.naverPrice !== undefined;
      const hasCoupangPrice = product.coupangPrice !== null && product.coupangPrice !== undefined;
      let lowestOnlinePrice = Infinity;
      if (hasNaverPrice) lowestOnlinePrice = Math.min(lowestOnlinePrice, product.naverPrice!);
      if (hasCoupangPrice) lowestOnlinePrice = Math.min(lowestOnlinePrice, product.coupangPrice!);
      const hasOnlinePrice = hasNaverPrice || hasCoupangPrice;

      const isExpensive = hasOnlinePrice && product.currentPrice > lowestOnlinePrice;
      if (!isExpensive) return false;
    } else if (filterStatus === 'UNSEARCHED') {
      const hasNaverPrice = product.naverPrice !== null && product.naverPrice !== undefined;
      const hasCoupangPrice = product.coupangPrice !== null && product.coupangPrice !== undefined;
      if (hasNaverPrice || hasCoupangPrice) return false;
    }

    return true;
  });

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (!sortConfig) return 0;

    const aValue = a[sortConfig.key];
    const bValue = b[sortConfig.key];

    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;

    if (aValue < bValue) {
      return sortConfig.direction === 'asc' ? -1 : 1;
    }
    if (aValue > bValue) {
      return sortConfig.direction === 'asc' ? 1 : -1;
    }
    return 0;
  });

  const handleCategoryChange = (nextCategory: ProductCategory) => {
    if (nextCategory === activeCategory) return;
    setActiveCategory(nextCategory);
    setSelectedIds([]);
    setFilterSupplier('ALL');
    setCurrentPage(1);
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
    fetchSettings();

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
      } catch (e) {}
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
      })
    );
  }, [activeCategory, filterStatus, filterSupplier, searchKeyword, sortConfig, currentPage, itemsPerPage, isRestored]);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success && data.config) {
        setNaverClientId(data.config['NAVER_CLIENT_ID'] || '');
        setNaverClientSecret(data.config['NAVER_CLIENT_SECRET'] || '');
      }
    } catch (error) {
      console.error('Failed to fetch settings', error);
    }
  };

  const downloadDiagnostics = () => {
    const failedItems = categoryProducts.filter(
      (p) => (p.naverPrice === null || p.naverPrice === undefined) && (p.coupangPrice === null || p.coupangPrice === undefined)
    );
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

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naverClientId, naverClientSecret }),
      });
      const data = await res.json();
      if (data.success) {
        alert('설정이 저장되었습니다.');
        setShowSettings(false);
      } else {
        alert('저장에 실패했습니다.');
      }
    } catch (error) {
      alert('오류가 발생했습니다.');
    } finally {
      setSavingSettings(false);
    }
  };

  const exportToExcel = () => {
    const data = sortedProducts.map((p) => ({
      카테고리: CATEGORY_META[normalizeCategory(p.category)].label,
      상품명: p.name,
      규격: p.spec || '',
      바코드: p.barcode || '',
      '현재 판매가': p.currentPrice,
      '온라인 최저가': p.naverPrice ?? '-',
      '쿠팡 최저가': p.coupangPrice ?? '-',
      공급사: p.supplier || '',
    }));

    if (data.length === 0) {
      alert('출력할 데이터가 없습니다.');
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, activeMeta.excelSheetName);
    XLSX.writeFile(workbook, `${activeMeta.exportPrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

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
        const text = await res.text();
        console.error('Non-JSON response:', text);
        alert('서버 오류가 발생했습니다. 개발자 도구 콘솔을 확인해주세요. (서버 재시작이 필요할 수 있습니다.)');
      }
    } catch (error) {
      console.error(error);
      alert('업로드 중 네트워크 오류가 발생했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // If the active category already has products, ask whether to replace or append
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
        // Supports Excel tab-separated copy/paste, pipe '|', or comma ','
        const parts = line.includes('\t')
          ? line.split('\t')
          : line.includes('|')
            ? line.split('|')
            : line.split(',');

        const trimmed = parts.map((p) => p.trim());
        // If 2 columns: [name, price] if 2nd is pure numbers, else [name, spec]
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
        payload = {
          category: addForm.category,
          items,
        };
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
        alert(`[${CATEGORY_META[addForm.category].label}] ${data.count}개의 상품이 추가되었습니다.`);
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

  const checkPrice = async (productId: number, productName: string, customKeyword?: string) => {
    setCheckingIds((prev) => new Set(prev).add(productId));
    setActiveSearches((prev) => [...prev, productName]);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId, customKeyword }),
      });
      const data = await res.json();
      if (data.success && data.product) {
        setProducts((prevProducts) => prevProducts.map((p) => (p.id === productId ? data.product : p)));

        if (customKeyword) {
          if (!data.product.naverPrice && !data.product.coupangPrice) {
            alert(
              '키워드를 수정하여 재조회했지만 여전히 조건에 맞는 최저가를 찾지 못했습니다.\n\n- 해당 상품이 온라인에 없거나\n- 용량/수량/묶음 조건이 맞지 않아 걸러졌을 수 있습니다.'
            );
          } else {
            alert('성공적으로 최저가를 찾아 반영했습니다!');
          }
        }
      } else {
        console.error('가격 조회 실패:', data.error);
        if (customKeyword) alert('오류가 발생했습니다: ' + (data.error || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
      setActiveSearches((prev) => prev.filter((name) => name !== productName));
    }
  };

  const checkAllPrices = async () => {
    const targets = categoryProducts;
    if (targets.length === 0) return;

    setLoading(true);
    setProgress({ current: 0, total: targets.length });

    let currentCount = 0;
    for (const product of targets) {
      await checkPrice(product.id, product.name);
      currentCount++;
      setProgress({ current: currentCount, total: targets.length });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    setLoading(false);
    setProgress(null);
    alert(`[${activeMeta.label}] ${targets.length}개 상품의 최저가 조회가 완료되었습니다.`);
  };

  const formatPrice = (price?: number) => {
    if (price === null || price === undefined) return '-';
    return price.toLocaleString() + '원';
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const toggleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(sortedProducts.map((p) => p.id));
    } else {
      setSelectedIds([]);
    }
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
    if (!confirm('수동 고정을 해제하시겠습니까? 가격과 링크가 모두 초기화(미조회 상태)됩니다.')) return;

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
          coupangPrice: '',
          coupangLink: '',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProducts(products.map((p) => (p.id === data.product.id ? data.product : p)));
        setEditingProduct(null);
      } else {
        alert('초기화에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
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
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProducts(products.map((p) => (p.id === data.product.id ? data.product : p)));
        setEditingProduct(null);
      } else {
        alert(data.error || '저장에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="container">
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <h1 className="title" style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          Search
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>v{packageJson.version}</span>
        </h1>
        <div className="upload-section" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={() => setShowSettings(true)}
            title="환경 설정"
            style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ⚙️ 설정
          </button>
          <button
            className="btn-secondary"
            onClick={openAddModal}
            style={{ fontWeight: 500, borderColor: 'var(--text-color)' }}
          >
            + 상품 직접 추가
          </button>
          <a href={`/api/template?category=${activeCategory}`} className="btn-secondary" style={{ textDecoration: 'none' }}>
            {activeMeta.shortLabel} 양식
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
            {uploading ? '업로드 중...' : `${activeMeta.shortLabel} 엑셀 업로드`}
          </label>
          <button
            className="btn-primary"
            onClick={checkAllPrices}
            disabled={loading || categoryProducts.length === 0}
            style={{ minWidth: '140px' }}
          >
            {loading && progress
              ? `조회 중 (${progress.current}/${progress.total})`
              : `${activeMeta.shortLabel} 전체 갱신`}
          </button>
          {selectedIds.length > 0 && (
            <>
              <a
                href={`/verify?ids=${selectedIds.join(',')}`}
                className="btn-secondary"
                style={{ textDecoration: 'none', backgroundColor: '#fffbe1', borderColor: '#fef08a', color: '#a16207', fontWeight: 600 }}
              >
                ⚡ 2차 검증 ({selectedIds.length})
              </a>
              <button
                className="btn-secondary"
                onClick={deleteSelected}
                style={{ color: 'white', backgroundColor: '#e11d48', borderColor: '#e11d48' }}
              >
                선택 삭제 ({selectedIds.length})
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
          적용 필터: {activeMeta.description}
        </div>
      </div>

      {loading && progress && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#fafafa', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
            <span>[{activeMeta.label}] 전체 가격 비교 진행 중...</span>
            <span style={{ fontWeight: 500 }}>
              {Math.round((progress.current / progress.total) * 100)}% ({progress.current} / {progress.total})
            </span>
          </div>
          <div style={{ width: '100%', height: '8px', backgroundColor: '#e5e5e5', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
                height: '100%',
                backgroundColor: 'var(--primary)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
                borderRadius: 'var(--radius)',
                fontSize: '0.85rem',
                width: '240px',
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
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value as any);
              setCurrentPage(1);
            }}
            style={{ padding: '0.4rem', fontSize: '0.85rem', border: '1px solid var(--border)', borderRadius: '4px' }}
          >
            <option value="ALL">전체 상태 보기</option>
            <option value="ADJUST_NEEDED">가격 조정 필요 항목만 보기</option>
            <option value="UNSEARCHED">미검색 항목 (- 표시) 보기</option>
          </select>

          <select
            value={filterSupplier}
            onChange={(e) => {
              setFilterSupplier(e.target.value);
              setCurrentPage(1);
            }}
            style={{ padding: '0.4rem', fontSize: '0.85rem', border: '1px solid var(--border)', borderRadius: '4px' }}
          >
            <option value="ALL">전체 공급사</option>
            {suppliers.map((sup) => (
              <option key={sup} value={sup}>
                {sup}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            className="btn-secondary"
            onClick={exportToExcel}
            style={{ fontSize: '0.85rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            현재 목록 엑셀 저장
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>페이지당 보기:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              style={{ padding: '0.3rem', fontSize: '0.85rem', border: '1px solid var(--border)', borderRadius: '0' }}
            >
              <option value={10}>10개</option>
              <option value={20}>20개</option>
              <option value={30}>30개</option>
              <option value={50}>50개</option>
              <option value={filteredProducts.length > 0 ? filteredProducts.length : 1000}>전체보기</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc' }}>
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    onChange={toggleSelectAll}
                    checked={sortedProducts.length > 0 && selectedIds.length === sortedProducts.length}
                  />
                </th>
                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  상품명{renderSortIndicator('name')}
                </th>
                <th onClick={() => handleSort('currentPrice')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  현재 판매가{renderSortIndicator('currentPrice')}
                </th>
                <th onClick={() => handleSort('naverPrice')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  온라인 최저가{renderSortIndicator('naverPrice')}
                </th>
                <th onClick={() => handleSort('coupangPrice')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  쿠팡 최저가{renderSortIndicator('coupangPrice')}
                </th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {sortedProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                    {categoryProducts.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <div>
                          등록된 <b>{activeMeta.label}</b> 상품이 없습니다. 엑셀을 업로드하거나 직접 상품을 추가해주세요.
                        </div>
                        <button className="btn-primary" onClick={openAddModal}>
                          + {activeMeta.shortLabel} 상품 직접 추가하기
                        </button>
                      </div>
                    ) : (
                      '조건에 맞는 상품이 없습니다.'
                    )}
                  </td>
                </tr>
              ) : (
                sortedProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((product) => {
                  const hasNaverPrice = product.naverPrice !== null && product.naverPrice !== undefined;
                  const hasCoupangPrice = product.coupangPrice !== null && product.coupangPrice !== undefined;

                  let lowestOnlinePrice = Infinity;
                  if (hasNaverPrice) lowestOnlinePrice = Math.min(lowestOnlinePrice, product.naverPrice!);
                  if (hasCoupangPrice) lowestOnlinePrice = Math.min(lowestOnlinePrice, product.coupangPrice!);

                  const hasOnlinePrice = hasNaverPrice || hasCoupangPrice;
                  const isExpensive = hasOnlinePrice && product.currentPrice > lowestOnlinePrice;

                  return (
                    <tr key={product.id}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(product.id)}
                          onChange={() => toggleSelect(product.id)}
                        />
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {product.name}
                        {product.spec && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8em', marginLeft: '4px' }}>{product.spec}</span>
                        )}
                        {product.supplier && (
                          <div style={{ color: '#8b5cf6', fontSize: '0.75rem', marginTop: '4px' }}>{product.supplier}</div>
                        )}
                      </td>
                      <td className="price">{formatPrice(product.currentPrice)}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className={`price ${hasNaverPrice && product.currentPrice > product.naverPrice! ? 'price-expensive' : ''}`}>
                            {formatPrice(product.naverPrice)}
                          </span>
                          {product.naverLink && (
                            <a href={product.naverLink} target="_blank" rel="noreferrer" className="link-icon">
                              🔗 최저가 바로가기
                            </a>
                          )}
                          <a
                            href={`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(
                              product.spec ? `${product.name} ${product.spec}` : product.name
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            className="link-icon"
                          >
                            🔎 쇼핑 검색화면
                          </a>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className={`price ${hasCoupangPrice && product.currentPrice > product.coupangPrice! ? 'price-expensive' : ''}`}>
                            {formatPrice(product.coupangPrice)}
                          </span>
                          {product.coupangLink && (
                            <a href={product.coupangLink} target="_blank" rel="noreferrer" className="link-icon">
                              🔗 쿠팡 바로가기
                            </a>
                          )}
                          <button
                            onClick={() => {
                              const kw = `${product.name} ${product.spec || ''}`.trim();
                              navigator.clipboard.writeText(kw);

                              const hideUntil = localStorage.getItem('hideCopyAlertUntil');
                              if (hideUntil && new Date().getTime() < parseInt(hideUntil)) {
                                window.open('https://fallcent.com/', '_blank');
                              } else {
                                setCopyAlertProduct({ name: product.name, searchKeyword: kw });
                              }
                            }}
                            className="link-icon"
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: '#6366f1' }}
                          >
                            🔎 최저가 검색
                          </button>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                          {checkingIds.has(product.id) ? (
                            <span className="badge" style={{ backgroundColor: '#e0e7ff', color: '#4338ca', fontWeight: 600 }}>
                              🔍 탐색 중...
                            </span>
                          ) : hasOnlinePrice ? (
                            isExpensive ? (
                              <span className="badge badge-red">가격 조정 필요</span>
                            ) : (
                              <span className="badge badge-green">적정가</span>
                            )
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                              <span className="badge" style={{ backgroundColor: '#f1f5f9' }}>미검색</span>
                              <a
                                href={`https://www.google.com/search?q=${encodeURIComponent(product.name + ' ' + (product.spec || ''))}`}
                                target="_blank"
                                rel="noreferrer"
                                className="link-icon"
                                style={{ fontSize: '0.75rem', color: '#ea4335', display: 'flex', alignItems: 'center', gap: '2px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'none' }}
                                title="구글에서 상품 검색하기"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0"></path>
                                  <path d="M12 2a10 10 0 0 1 10 10"></path>
                                  <path d="M12 22a10 10 0 0 1-10-10"></path>
                                  <path d="M2 12h20"></path>
                                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                                </svg>
                                구글 검색
                              </a>
                            </div>
                          )}

                          {product.lastCheckedAt && !checkingIds.has(product.id) && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {formatDate(product.lastCheckedAt)} 검색
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <button
                            className="btn-secondary btn-small"
                            onClick={() => checkPrice(product.id, product.name)}
                            disabled={checkingIds.has(product.id) || loading || product.isManualOverride}
                            style={{ minWidth: '70px', opacity: product.isManualOverride ? 0.6 : 1 }}
                            title={product.isManualOverride ? '수동으로 가격이 고정되었습니다.' : ''}
                          >
                            {checkingIds.has(product.id) ? '조회 중...' : product.isManualOverride ? '🔒 수동 고정' : '가격 확인'}
                          </button>

                          <button
                            className="btn-secondary btn-small"
                            onClick={() => {
                              setTuningProduct({ id: product.id, name: product.name, keyword: product.spec ? `${product.name} ${product.spec}` : product.name });
                            }}
                            disabled={checkingIds.has(product.id) || loading || product.isManualOverride}
                            style={{ minWidth: '70px', padding: '4px', fontSize: '0.75rem', backgroundColor: '#f8fafc' }}
                            title="이름이 길거나 기호가 많아 검색이 안 될 때 키워드를 수정해서 다시 검색합니다."
                          >
                            키워드 수정
                          </button>

                          <button
                            className="btn-secondary btn-small"
                            onClick={() => handleEditClick(product)}
                            style={{ minWidth: '70px', padding: '4px' }}
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

      {/* Upload Mode Choice Modal (Replace vs Append within Active Category) */}
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
            style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '420px', maxWidth: '90%' }}
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
              <button
                className="btn-primary"
                onClick={() => executeFileUpload(pendingUploadFile, 'append')}
                style={{ padding: '10px' }}
              >
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

      {/* Manual Product Add Modal (Single + Bulk Paste) */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => !savingAdd && setShowAddModal(false)}
        >
          <div
            style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '500px', maxWidth: '92%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '14px', fontSize: '1.2rem', fontWeight: 600 }}>
              상품 직접 추가
            </h2>

            {/* Category selector inside modal */}
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

            {/* Single vs Bulk toggle */}
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
                      현재 판매가 (원)
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
                        ? '동원 라이트스탠다드 참치, 85g 12캔, 18900, 동원F&B\n농심 신라면, 120g 5입, 4600, 농심'
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
            style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '400px', maxWidth: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.25rem', fontWeight: 600 }}>가격 및 링크 수기 입력</h2>
            <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '8px' }}>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>카테고리</label>
                <div style={{ marginTop: '4px' }}>
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
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>현재 판매가</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <input
                    type="number"
                    value={editForm.currentPrice}
                    onChange={(e) => setEditForm({ ...editForm, currentPrice: e.target.value })}
                    placeholder="숫자만 입력"
                    className="search-input"
                    style={{ width: '100%', paddingRight: '28px' }}
                  />
                  {editForm.currentPrice && (
                    <button
                      onClick={() => setEditForm({ ...editForm, currentPrice: '' })}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="비우기"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>네이버 최저가</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <input
                    type="number"
                    value={editForm.naverPrice}
                    onChange={(e) => setEditForm({ ...editForm, naverPrice: e.target.value })}
                    placeholder="숫자만 입력"
                    className="search-input"
                    style={{ width: '100%', paddingRight: '28px' }}
                  />
                  {editForm.naverPrice && (
                    <button
                      onClick={() => setEditForm({ ...editForm, naverPrice: '' })}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="비우기"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>네이버 링크</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <input
                    type="text"
                    value={editForm.naverLink}
                    onChange={(e) => setEditForm({ ...editForm, naverLink: e.target.value })}
                    placeholder="https://..."
                    className="search-input"
                    style={{ width: '100%', paddingRight: '28px' }}
                  />
                  {editForm.naverLink && (
                    <button
                      onClick={() => setEditForm({ ...editForm, naverLink: '' })}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="비우기"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>쿠팡 최저가</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <input
                    type="number"
                    value={editForm.coupangPrice}
                    onChange={(e) => setEditForm({ ...editForm, coupangPrice: e.target.value })}
                    placeholder="숫자만 입력"
                    className="search-input"
                    style={{ width: '100%', paddingRight: '28px' }}
                  />
                  {editForm.coupangPrice && (
                    <button
                      onClick={() => setEditForm({ ...editForm, coupangPrice: '' })}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="비우기"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label>쿠팡 링크</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <input
                    type="text"
                    value={editForm.coupangLink}
                    onChange={(e) => setEditForm({ ...editForm, coupangLink: e.target.value })}
                    placeholder="https://..."
                    className="search-input"
                    style={{ width: '100%', paddingRight: '28px' }}
                  />
                  {editForm.coupangLink && (
                    <button
                      onClick={() => setEditForm({ ...editForm, coupangLink: '' })}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="비우기"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px', background: '#f1f5f9', padding: '8px', borderRadius: '4px' }}>
              ℹ️ 저장을 누르시면 해당 상품은 <b>[🔒 수동 고정]</b> 상태가 되어 자동 갱신되지 않습니다.
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                className="btn-secondary"
                onClick={handleResetOverride}
                disabled={savingEdit}
                style={{ marginRight: 'auto', color: '#ef4444', borderColor: '#fca5a5', backgroundColor: '#fef2f2' }}
              >
                {editingProduct.isManualOverride ? '🔓 고정 해제 (초기화)' : '🔄 전체 비우기 (초기화)'}
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
            style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '400px', maxWidth: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '12px', fontSize: '1.25rem', fontWeight: 600 }}>검색 키워드 튜닝</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              이름이 길거나 기호가 많아 검색이 안 될 때 키워드를 짧고 명확하게 수정하여 재조회해보세요.
              <br />
              <br />
              (예: <span style={{ color: '#ea4335' }}>포엘리에 옴므 올인원 5In 1 퍼펙트로션 150ml (미백)</span>
              <br />👉 <span style={{ color: '#16a34a', fontWeight: 'bold' }}>포엘리에 옴므 퍼펙트로션 150ml</span>)
            </p>
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <input
                type="text"
                value={tuningProduct.keyword}
                onChange={(e) => setTuningProduct({ ...tuningProduct, keyword: e.target.value })}
                className="search-input"
                style={{ width: '100%', padding: '10px', fontSize: '0.95rem' }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tuningProduct.keyword.trim() !== '') {
                    checkPrice(tuningProduct.id, tuningProduct.name, tuningProduct.keyword.trim());
                    setTuningProduct(null);
                  }
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setTuningProduct(null)}>
                취소
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (tuningProduct.keyword.trim() !== '') {
                    checkPrice(tuningProduct.id, tuningProduct.name, tuningProduct.keyword.trim());
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

      {/* Settings Modal */}
      {showSettings && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => !savingSettings && setShowSettings(false)}
        >
          <div
            style={{ backgroundColor: 'white', padding: '2rem', borderRadius: '8px', width: '400px', maxWidth: '90%', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.25rem' }}>환경 설정</h2>

            <div style={{ fontSize: '0.8rem', color: '#0f766e', backgroundColor: '#f0fdfa', border: '1px solid #ccfbf1', padding: '10px 12px', borderRadius: '4px', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              ✅ <b>에누리 · 다나와 통합 가격비교 엔진</b>이 기본 적용되어 있어, 별도의 API 키 없이도 모든 카테고리의 최저가를 조회할 수 있습니다.
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 500 }}>
                네이버 Client ID
              </label>
              <input
                type="text"
                value={naverClientId}
                onChange={(e) => setNaverClientId(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                placeholder="네이버 오픈 API Client ID 입력"
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 500 }}>
                네이버 Client Secret
              </label>
              <input
                type="password"
                value={naverClientSecret}
                onChange={(e) => setNaverClientSecret(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                placeholder="네이버 오픈 API Client Secret 입력"
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem' }}>
              <button
                className="btn-secondary"
                onClick={downloadDiagnostics}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', backgroundColor: '#f1f5f9' }}
              >
                📥 미검색 진단 ({activeMeta.shortLabel})
              </button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-secondary" onClick={() => setShowSettings(false)}>
                  취소
                </button>
                <button className="btn-primary" onClick={saveSettings} disabled={savingSettings}>
                  {savingSettings ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toasts for Active Searches */}
      {activeSearches.length > 0 && (
        <div
          style={{
            position: 'fixed', bottom: '20px', right: '20px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 9999,
            pointerEvents: 'none',
          }}
        >
          {activeSearches.map((name, idx) => (
            <div
              key={`${name}-${idx}`}
              style={{
                background: '#1e293b', color: 'white', padding: '12px 20px', borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '12px',
                animation: 'slideIn 0.3s ease-out forwards',
              }}
            >
              <div
                style={{
                  width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite',
                }}
              />
              <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                <span style={{ color: '#60a5fa' }}>{name}</span> 최저가 검색 중...
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Copy Alert Modal */}
      {copyAlertProduct && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => setCopyAlertProduct(null)}
        >
          <div
            style={{ background: '#fff', padding: '16px', width: '280px', maxWidth: '90%', textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px 0', color: '#0f172a', fontSize: '16px', fontWeight: 600 }}>품명 복사 완료</h3>
            <p style={{ color: '#475569', fontSize: '13px', margin: '0 0 16px 0', wordBreak: 'keep-all' }}>
              새 창의 검색창에 <b>붙여넣기(Ctrl+V)</b> 하세요.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                className="btn-primary"
                style={{ padding: '10px', borderRadius: '0', fontSize: '14px', fontWeight: 500 }}
                onClick={() => {
                  window.open('https://fallcent.com/', '_blank');
                  setCopyAlertProduct(null);
                }}
              >
                새 창 열기
              </button>
              <button
                className="btn-secondary"
                style={{ fontSize: '12px', border: 'none', background: 'transparent', color: '#94a3b8', padding: '6px', borderRadius: '0' }}
                onClick={() => {
                  const tomorrow = new Date().getTime() + 24 * 60 * 60 * 1000;
                  localStorage.setItem('hideCopyAlertUntil', tomorrow.toString());
                  window.open('https://fallcent.com/', '_blank');
                  setCopyAlertProduct(null);
                }}
              >
                오늘 하루 보지 않기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
