/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📑 VN30F V10.0 — Dynamic Contract Resolver (FIX-02)        ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Resolves current active F1M & F2M symbols dynamically       ║
 * ║  Zero hardcoded fallback. Throws/flags if unresolved         ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');

const VPS_PS_LIST_MAP = 'https://bgapidatafeed.vps.com.vn/pslistmap';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

let _contractCache = {
  f1m: null,          // { symbol: '41I1...', chartCode: 'VN30F1M', matureDate: '19/11/2026' }
  f2m: null,          // { symbol: '41I1...', chartCode: 'VN30F2M', matureDate: '17/12/2026' }
  allSymbols: [],
  resolvedAt: 0,
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolves active futures contracts from exchange list map.
 * @param {boolean} forceRefresh
 * @returns {Promise<{ f1m: object|null, f2m: object|null, allSymbols: string[], resolved: boolean, error?: string }>}
 */
async function resolveActiveContracts(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _contractCache.f1m && (now - _contractCache.resolvedAt < CACHE_TTL_MS)) {
    return {
      f1m: _contractCache.f1m,
      f2m: _contractCache.f2m,
      allSymbols: _contractCache.allSymbols,
      resolved: true,
    };
  }

  try {
    const res = await axios.get(VPS_PS_LIST_MAP, { headers: HEADERS, timeout: 5000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      const f1Item = res.data.find(d => (d.CHART_CODE || '').toUpperCase() === 'VN30F1M');
      const f2Item = res.data.find(d => (d.CHART_CODE || '').toUpperCase() === 'VN30F2M');

      const allSymbols = res.data
        .filter(d => (d.CHART_CODE || '').startsWith('VN30F'))
        .map(d => d.SYMBOL);

      if (f1Item && f1Item.SYMBOL) {
        _contractCache = {
          f1m: {
            symbol: f1Item.SYMBOL,
            chartCode: 'VN30F1M',
            matureDate: f1Item.MATURE_DATE || f1Item.matureDate || null,
            name: f1Item.NAME || null,
          },
          f2m: f2Item && f2Item.SYMBOL ? {
            symbol: f2Item.SYMBOL,
            chartCode: 'VN30F2M',
            matureDate: f2Item.MATURE_DATE || f2Item.matureDate || null,
            name: f2Item.NAME || null,
          } : null,
          allSymbols,
          resolvedAt: now,
        };

        return {
          f1m: _contractCache.f1m,
          f2m: _contractCache.f2m,
          allSymbols: _contractCache.allSymbols,
          resolved: true,
        };
      }
    }
  } catch (err) {
    // Cannot reach mapping service
    console.error('   ⚠️ [ContractResolver] Lỗi fetch pslistmap:', err.message);
  }

  // If cached data exists even if older, use it as fallback
  if (_contractCache.f1m) {
    return {
      f1m: _contractCache.f1m,
      f2m: _contractCache.f2m,
      allSymbols: _contractCache.allSymbols,
      resolved: true,
      stale: true,
    };
  }

  // DQ-08: If unresolved, do NOT silently inject old hardcoded symbols. Flag as unresolved.
  return {
    f1m: null,
    f2m: null,
    allSymbols: [],
    resolved: false,
    error: 'CONTRACT_UNRESOLVED: Failed to resolve VN30F active contracts from exchange map',
  };
}

function getResolvedContracts() {
  return _contractCache;
}

function resetContractCache() {
  _contractCache = { f1m: null, f2m: null, allSymbols: [], resolvedAt: 0 };
}

module.exports = {
  resolveActiveContracts,
  getResolvedContracts,
  resetContractCache,
};
