'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import '../globals.css';

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

type Candidate = {
  title: string;
  link: string;
  image: string;
  lprice: string;
  mallName: string;
};

function VerifyMatchContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get('ids');

  const [products, setProducts] = useState<Product[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProducts();
  }, [idsParam]);

  const fetchProducts = async () => {
    setInitialLoading(true);
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      if (data.products) {
        let filtered = data.products;
        if (idsParam) {
          const ids = idsParam.split(',').map(Number);
          filtered = filtered.filter((p: Product) => ids.includes(p.id));
        }
        setProducts(filtered);
      }
    } catch (error) {
      console.error('Failed to fetch products', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const currentProduct = products[currentIndex];

  useEffect(() => {
    if (currentProduct) {
      // Auto-extract keywords and search
      const query = currentProduct.spec ? `${currentProduct.name} ${currentProduct.spec}` : currentProduct.name;
      setSearchQuery(query);
      fetchCandidates(query);
    }
  }, [currentIndex, currentProduct]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in input
      if (document.activeElement?.tagName === 'INPUT') return;

      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (candidates[index]) {
          handleSelectCandidate(candidates[index]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, candidates]);

  const fetchCandidates = async (query: string) => {
    if (!query) return;
    setLoadingCandidates(true);
    try {
      const res = await fetch(`/api/candidates?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success) {
        setCandidates(data.candidates);
      } else {
        setCandidates([]);
      }
    } catch (error) {
      console.error('Failed to fetch candidates', error);
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const handleNext = () => {
    if (currentIndex < products.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const extractTags = (text: string) => {
    return text.split(' ').filter(t => t.trim().length > 0);
  };

  const handleSelectCandidate = async (candidate: Candidate) => {
    if (!currentProduct) return;
    
    const isCoupang = candidate.mallName.toLowerCase().includes('쿠팡') || candidate.mallName.toLowerCase().includes('coupang');
    
    try {
      const res = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentProduct.id,
          isManualOverride: true,
          naverPrice: isCoupang ? currentProduct.naverPrice : candidate.lprice,
          naverLink: isCoupang ? currentProduct.naverLink : candidate.link,
          coupangPrice: isCoupang ? candidate.lprice : currentProduct.coupangPrice,
          coupangLink: isCoupang ? candidate.link : currentProduct.coupangLink,
        })
      });
      const data = await res.json();
      if (data.success) {
        // Update local state
        setProducts(prev => prev.map(p => p.id === currentProduct.id ? data.product : p));
        // Auto advance
        handleNext();
      } else {
        alert('저장에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('오류가 발생했습니다.');
    }
  };

  const formatPrice = (price?: number | string) => {
    if (!price) return '-';
    return Number(price).toLocaleString() + '원';
  };

  const getUnitMultiplier = (title: string): number => {
    // Very simple regex to find "2개", "x 3", etc. to calculate unit price
    const match = title.match(/(?:x\s*([2-9]|\d{2,})|([2-9]|\d{2,})\s*(?:개|ea|p|입))/i);
    if (match) {
      return parseInt(match[1] || match[2], 10);
    }
    return 1;
  };

  if (initialLoading) {
    return <div className="container" style={{ padding: '2rem', textAlign: 'center' }}>상품을 불러오는 중...</div>;
  }

  if (products.length === 0) {
    return <div className="container" style={{ padding: '2rem', textAlign: 'center' }}>검증할 대상 상품이 없습니다. 메인 화면에서 상품을 선택해주세요.</div>;
  }

  if (!currentProduct) return null;

  const targetTags = extractTags(`${currentProduct.name} ${currentProduct.spec || ''}`);

  return (
    <div className="container" style={{ maxWidth: '100%', height: '100vh', display: 'flex', flexDirection: 'column', padding: '1rem' }}>
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 className="title" style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <a href="/" style={{ textDecoration: 'none', color: 'var(--text-muted)', fontSize: '1rem' }}>← 돌아가기</a>
          <span>⚡ 2차 검증 모드</span>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>진행률: {currentIndex + 1} / {products.length}</span>
          <button className="btn-secondary btn-small" onClick={handlePrev} disabled={currentIndex === 0}>이전 (←)</button>
          <button className="btn-primary btn-small" onClick={handleNext} disabled={currentIndex === products.length - 1}>건너뛰기 (→ / Space)</button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: '1rem', flex: 1, minHeight: 0 }}>
        {/* Left Panel: Target Product */}
        <div className="card" style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', backgroundColor: '#f8fafc' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>대상 상품 정보</div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-color)' }}>
              {currentProduct.name}
            </h2>
            <div style={{ color: '#6366f1', fontSize: '0.9rem', marginTop: '4px', fontWeight: 500 }}>
              {currentProduct.spec}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fff', borderRadius: '4px', border: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>기준 판매가</span>
              <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>{formatPrice(currentProduct.currentPrice)}</span>
            </div>
          </div>
          
          <div style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>빠른 검색 키워드 (클릭하여 검색어 적용)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {targetTags.map((tag, i) => (
                <button 
                  key={i}
                  className="btn-secondary btn-small"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', borderRadius: '12px' }}
                  onClick={() => {
                    const newQuery = searchQuery ? `${searchQuery} ${tag}` : tag;
                    setSearchQuery(newQuery);
                    fetchCandidates(newQuery);
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
            <button 
              className="btn-secondary btn-small" 
              style={{ marginTop: '0.8rem', width: '100%', fontSize: '0.8rem' }}
              onClick={() => {
                setSearchQuery('');
                if(searchInputRef.current) searchInputRef.current.focus();
              }}
            >
              검색어 초기화
            </button>
          </div>

          <div style={{ padding: '1rem', marginTop: 'auto', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>현재 기록된 가격</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>네이버:</span> 
                <span style={{ fontWeight: 500 }}>{formatPrice(currentProduct.naverPrice)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>쿠팡:</span> 
                <span style={{ fontWeight: 500 }}>{formatPrice(currentProduct.coupangPrice)}</span>
              </div>
              {currentProduct.isManualOverride && (
                <div style={{ textAlign: 'right', fontSize: '0.75rem', color: '#e11d48', marginTop: '0.2rem' }}>
                  🔒 수동 고정됨
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Search & Candidates */}
        <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.5rem' }}>
            <input 
              ref={searchInputRef}
              type="text" 
              className="search-input" 
              style={{ flex: 1 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') fetchCandidates(searchQuery);
              }}
              placeholder="검색어를 입력하고 Enter를 누르세요"
            />
            <button className="btn-primary" onClick={() => fetchCandidates(searchQuery)}>
              검색
            </button>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', padding: '0', backgroundColor: '#f8fafc' }}>
            {loadingCandidates ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>후보군 검색 중...</div>
            ) : candidates.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>검색 결과가 없습니다.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {candidates.map((cand, idx) => {
                  const numPrice = parseInt(cand.lprice, 10);
                  const multiplier = getUnitMultiplier(cand.title);
                  const unitPrice = multiplier > 1 ? Math.floor(numPrice / multiplier) : numPrice;
                  
                  // Outlier warning (if unit price is wildly cheap)
                  const isSuspicious = currentProduct.currentPrice && (unitPrice < currentProduct.currentPrice * 0.4);

                  return (
                    <div 
                      key={idx} 
                      style={{ 
                        display: 'flex', 
                        padding: '1rem', 
                        borderBottom: '1px solid var(--border)', 
                        backgroundColor: '#fff',
                        transition: 'background-color 0.2s',
                        borderLeft: isSuspicious ? '4px solid #f59e0b' : '4px solid transparent'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fff'}
                    >
                      <div style={{ flex: '0 0 80px', marginRight: '1rem' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cand.image} alt="thumbnail" style={{ width: '80px', height: '80px', objectFit: 'contain', borderRadius: '4px', border: '1px solid #e2e8f0' }} />
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>{cand.mallName}</span>
                            {idx < 5 && <span style={{ backgroundColor: '#e2e8f0', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>단축키 {idx + 1}</span>}
                          </div>
                          <div 
                            style={{ fontSize: '0.9rem', color: 'var(--text-color)', lineHeight: '1.4', wordBreak: 'keep-all' }} 
                            dangerouslySetInnerHTML={{ __html: cand.title }} 
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.5rem' }}>
                          <div>
                            <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e11d48' }}>{formatPrice(cand.lprice)}</span>
                            {multiplier > 1 && (
                              <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: '6px' }}>
                                (개당 {formatPrice(unitPrice)})
                              </span>
                            )}
                            {isSuspicious && (
                              <span style={{ fontSize: '0.75rem', color: '#d97706', marginLeft: '8px', fontWeight: 600 }}>⚠️ 옵션장난 주의</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <a 
                              href={cand.link} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="btn-secondary btn-small"
                              style={{ textDecoration: 'none', padding: '0.3rem 0.6rem' }}
                            >
                              확인
                            </a>
                            <button 
                              className="btn-primary btn-small"
                              style={{ padding: '0.3rem 1rem' }}
                              onClick={() => handleSelectCandidate(cand)}
                            >
                              이 가격으로 확정
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyMatch() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
      <VerifyMatchContent />
    </Suspense>
  );
}
