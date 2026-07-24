'use client';

import React, { useState, useEffect, useRef } from 'react';
import './globals.css';

type Product = {
  id: number;
  name: string;
  spec?: string;
  barcode?: string;
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
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ADJUST_NEEDED'>('ALL');
  const [filterSupplier, setFilterSupplier] = useState<string>('ALL');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  // Edit states
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({ naverPrice: '', naverLink: '', coupangPrice: '', coupangLink: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [copyAlertProduct, setCopyAlertProduct] = useState<{name: string, searchKeyword: string} | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived states
  const suppliers = Array.from(new Set(products.map(p => p.supplier).filter(Boolean))) as string[];
  
  const filteredProducts = products.filter(product => {
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
    }
    
    return true;
  });

  useEffect(() => {
    fetchProducts();
    fetchSettings();
  }, []);

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
        alert('설정 저장 실패');
      }
    } catch (error) {
      console.error('Failed to save settings', error);
      alert('설정 저장 중 오류 발생');
    } finally {
      setSavingSettings(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      if (data.products) {
        setProducts(data.products);
        setCurrentPage(1); // Reset to first page on load
      }
    } catch (error) {
      console.error('Failed to fetch products', error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await res.json();
        if (data.success) {
          alert(`성공적으로 ${data.count}개의 상품을 업로드했습니다.`);
          fetchProducts();
          setCurrentPage(1); // Reset to first page after upload
        } else {
          alert(data.error || '업로드에 실패했습니다.');
        }
      } else {
        const text = await res.text();
        console.error("Non-JSON response:", text);
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

  const checkPrice = async (productId: number, productName: string) => {
    setCheckingIds(prev => new Set(prev).add(productId));
    setActiveSearches(prev => [...prev, productName]);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (data.success && data.product) {
        setProducts(prevProducts => prevProducts.map(p => p.id === productId ? data.product : p));
      } else {
        console.error('가격 조회 실패:', data.error);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setCheckingIds(prev => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
      setActiveSearches(prev => prev.filter(name => name !== productName));
    }
  };

  const checkAllPrices = async () => {
    setLoading(true);
    setProgress({ current: 0, total: products.length });
    
    let currentCount = 0;
    for (const product of products) {
      await checkPrice(product.id, product.name);
      currentCount++;
      setProgress({ current: currentCount, total: products.length });
      // Small delay to prevent API rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    setLoading(false);
    setProgress(null);
    alert('모든 상품의 최저가 조회가 완료되었습니다.');
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
      setSelectedIds(filteredProducts.map(p => p.id));
    } else {
      setSelectedIds([]);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
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
        setProducts(products.filter(p => !selectedIds.includes(p.id)));
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
          coupangLink: ''
        })
      });
      const data = await res.json();
      if (data.success) {
        setProducts(products.map(p => p.id === data.product.id ? data.product : p));
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
      naverPrice: product.naverPrice ? String(product.naverPrice) : '',
      naverLink: product.naverLink || '',
      coupangPrice: product.coupangPrice ? String(product.coupangPrice) : '',
      coupangLink: product.coupangLink || ''
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
          naverPrice: editForm.naverPrice,
          naverLink: editForm.naverLink,
          coupangPrice: editForm.coupangPrice,
          coupangLink: editForm.coupangLink
        })
      });
      const data = await res.json();
      if (data.success) {
        setProducts(products.map(p => p.id === data.product.id ? data.product : p));
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
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="title"></h1>
        <div className="upload-section" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            className="btn-secondary" 
            onClick={() => setShowSettings(true)}
            title="환경 설정"
            style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ⚙️ 설정
          </button>
          <a href="/api/template" className="btn-secondary" style={{ textDecoration: 'none' }}>
            양식 다운로드
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
            className="btn-primary" 
            onClick={checkAllPrices}
            disabled={loading || products.length === 0}
            style={{ minWidth: '140px' }}
          >
            {loading && progress ? `조회 중 (${progress.current}/${progress.total})` : '전체 가격 갱신'}
          </button>
          {selectedIds.length > 0 && (
            <button 
              className="btn-secondary" 
              onClick={deleteSelected}
              style={{ color: 'white', backgroundColor: '#e11d48', borderColor: '#e11d48' }}
            >
              선택 삭제 ({selectedIds.length})
            </button>
          )}
        </div>
      </header>

      {loading && progress && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#fafafa', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
            <span>전체 가격 비교 진행 중...</span>
            <span style={{ fontWeight: 500 }}>{Math.round((progress.current / progress.total) * 100)}% ({progress.current} / {progress.total})</span>
          </div>
          <div style={{ width: '100%', height: '8px', backgroundColor: '#e5e5e5', borderRadius: '4px', overflow: 'hidden' }}>
            <div 
              style={{ 
                width: `${(progress.current / progress.total) * 100}%`, 
                height: '100%', 
                backgroundColor: 'var(--primary)',
                transition: 'width 0.3s ease'
              }} 
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500 }}>
            <input 
              type="checkbox" 
              checked={filterStatus === 'ADJUST_NEEDED'}
              onChange={(e) => {
                setFilterStatus(e.target.checked ? 'ADJUST_NEEDED' : 'ALL');
                setCurrentPage(1);
              }}
              style={{ width: '16px', height: '16px' }}
            />
            가격 조정 필요 항목만 보기
          </label>
          
          <select 
            value={filterSupplier}
            onChange={(e) => {
              setFilterSupplier(e.target.value);
              setCurrentPage(1);
            }}
            style={{ padding: '0.4rem', fontSize: '0.85rem', border: '1px solid var(--border)', borderRadius: '4px' }}
          >
            <option value="ALL">전체 공급사</option>
            {suppliers.map(sup => (
              <option key={sup} value={sup}>{sup}</option>
            ))}
          </select>
        </div>

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

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <input 
                    type="checkbox" 
                    onChange={toggleSelectAll}
                    checked={filteredProducts.length > 0 && selectedIds.length === filteredProducts.length}
                  />
                </th>
                <th>상품명</th>
                <th>현재 판매가</th>
                <th>네이버 최저가</th>
                <th>쿠팡 최저가</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                    {products.length === 0 ? '등록된 상품이 없습니다. 엑셀 파일을 업로드해주세요.' : '조건에 맞는 상품이 없습니다.'}
                  </td>
                </tr>
              ) : (
                filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((product) => {
                  const hasNaverPrice = product.naverPrice !== null && product.naverPrice !== undefined;
                  const hasCoupangPrice = product.coupangPrice !== null && product.coupangPrice !== undefined;
                  
                  // Find the absolute lowest price
                  let lowestOnlinePrice = Infinity;
                  if (hasNaverPrice) lowestOnlinePrice = Math.min(lowestOnlinePrice, product.naverPrice!);
                  if (hasCoupangPrice) lowestOnlinePrice = Math.min(lowestOnlinePrice, product.coupangPrice!);
                  
                  const hasOnlinePrice = hasNaverPrice || hasCoupangPrice;
                  const isExpensive = hasOnlinePrice && product.currentPrice > lowestOnlinePrice;
                  const isCheaper = hasOnlinePrice && product.currentPrice <= lowestOnlinePrice;

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
                        {product.spec && <span style={{ color: 'var(--text-muted)', fontSize: '0.8em', marginLeft: '4px' }}>{product.spec}</span>}
                        {product.supplier && <div style={{ color: '#8b5cf6', fontSize: '0.75rem', marginTop: '4px' }}>{product.supplier}</div>}
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
                            href={`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(product.spec ? `${product.name} ${product.spec}` : product.name)}`} 
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
                              const searchKeyword = `${product.name} ${product.spec || ''}`.trim();
                              navigator.clipboard.writeText(searchKeyword);
                              
                              const hideUntil = localStorage.getItem('hideCopyAlertUntil');
                              if (hideUntil && new Date().getTime() < parseInt(hideUntil)) {
                                window.open('https://fallcent.com/', '_blank');
                              } else {
                                setCopyAlertProduct({ name: product.name, searchKeyword });
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
                            <span className="badge" style={{ backgroundColor: '#f1f5f9' }}>미조회</span>
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
                            title={product.isManualOverride ? "수동으로 가격이 고정되었습니다." : ""}
                          >
                            {checkingIds.has(product.id) ? '조회 중...' : (product.isManualOverride ? '🔒 수동 고정' : '가격 확인')}
                          </button>
                          <button 
                            className="btn-secondary btn-small"
                            onClick={() => handleEditClick(product)}
                            style={{ minWidth: '70px', padding: '4px' }}
                          >
                            수정
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
        {filteredProducts.length > 0 && itemsPerPage < filteredProducts.length && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem', gap: '1rem', borderTop: '1px solid var(--border)' }}>
            <button 
              className="btn-secondary btn-small" 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              이전
            </button>
            <span style={{ fontSize: '0.85rem' }}>
              {currentPage} / {Math.ceil(filteredProducts.length / itemsPerPage)} 페이지
            </span>
            <button 
              className="btn-secondary btn-small" 
              onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredProducts.length / itemsPerPage), p + 1))}
              disabled={currentPage === Math.ceil(filteredProducts.length / itemsPerPage)}
            >
              다음
            </button>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingProduct && (
        <div 
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
          }}
          onClick={() => !savingEdit && setEditingProduct(null)}
        >
          <div 
            style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '400px', maxWidth: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.25rem', fontWeight: 600 }}>가격 및 링크 수기 입력</h2>
            <div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>네이버 최저가</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <input 
                    type="number" 
                    value={editForm.naverPrice} 
                    onChange={e => setEditForm({...editForm, naverPrice: e.target.value})} 
                    placeholder="숫자만 입력"
                    className="search-input"
                    style={{ width: '100%', paddingRight: '28px' }}
                  />
                  {editForm.naverPrice && (
                    <button 
                      onClick={() => setEditForm({...editForm, naverPrice: ''})}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="비우기"
                    >✕</button>
                  )}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>네이버 링크</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <input 
                    type="text" 
                    value={editForm.naverLink} 
                    onChange={e => setEditForm({...editForm, naverLink: e.target.value})} 
                    placeholder="https://..."
                    className="search-input"
                    style={{ width: '100%', paddingRight: '28px' }}
                  />
                  {editForm.naverLink && (
                    <button 
                      onClick={() => setEditForm({...editForm, naverLink: ''})}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="비우기"
                    >✕</button>
                  )}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label>쿠팡 최저가</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <input 
                    type="number" 
                    value={editForm.coupangPrice} 
                    onChange={e => setEditForm({...editForm, coupangPrice: e.target.value})} 
                    placeholder="숫자만 입력"
                    className="search-input"
                    style={{ width: '100%', paddingRight: '28px' }}
                  />
                  {editForm.coupangPrice && (
                    <button 
                      onClick={() => setEditForm({...editForm, coupangPrice: ''})}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="비우기"
                    >✕</button>
                  )}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label>쿠팡 링크</label>
                <div style={{ position: 'relative', marginTop: '4px' }}>
                  <input 
                    type="text" 
                    value={editForm.coupangLink} 
                    onChange={e => setEditForm({...editForm, coupangLink: e.target.value})} 
                    placeholder="https://..."
                    className="search-input"
                    style={{ width: '100%', paddingRight: '28px' }}
                  />
                  {editForm.coupangLink && (
                    <button 
                      onClick={() => setEditForm({...editForm, coupangLink: ''})}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="비우기"
                    >✕</button>
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
              <button 
                className="btn-secondary" 
                onClick={() => setEditingProduct(null)}
                disabled={savingEdit}
              >
                취소
              </button>
              <button 
                className="btn-primary" 
                onClick={handleSaveEdit}
                disabled={savingEdit}
              >
                {savingEdit ? '저장 중...' : '저장'}
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
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
          }}
          onClick={() => !savingSettings && setShowSettings(false)}
        >
          <div 
            style={{ backgroundColor: 'white', padding: '2rem', borderRadius: '8px', width: '400px', maxWidth: '90%', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem', fontSize: '1.25rem' }}>환경 설정</h2>
            
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
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button 
                className="btn-secondary" 
                onClick={() => setShowSettings(false)}
              >
                취소
              </button>
              <button 
                className="btn-primary" 
                onClick={saveSettings}
                disabled={savingSettings}
              >
                {savingSettings ? '저장 중...' : '저장하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toasts for Active Searches */}
      {activeSearches.length > 0 && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 9999,
          pointerEvents: 'none'
        }}>
          {activeSearches.map((name, idx) => (
            <div key={`${name}-${idx}`} style={{
              background: '#1e293b', color: 'white', padding: '12px 20px', borderRadius: '8px', 
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '12px',
              animation: 'slideIn 0.3s ease-out forwards'
            }}>
              <div style={{ 
                width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', 
                borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' 
              }} />
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
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
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
