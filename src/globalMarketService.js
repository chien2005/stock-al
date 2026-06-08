/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║     🌍 VN STOCK BOT - Global Market Service v2.0             ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Lấy dữ liệu TTCK quốc tế để dự báo ảnh hưởng TTCK VN     ║
 * ║  Source: Yahoo Finance (yahoo-finance2)                       ║
 * ║                                                               ║
 * ║  📊 Chỉ số chính: S&P 500, NASDAQ, Dow Jones, Nikkei...     ║
 * ║  🏦 ETF ngành: XLF, XLK, XLY, XLP, XLB, XLE, XLRE...       ║
 * ║  💱 Tỷ giá: USD/VND, DXY, Vàng, Dầu                         ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Cache dữ liệu lần cuối thành công (fallback khi Yahoo lỗi)
let _lastGoodIndices = null;
let _lastGoodETFs = null;
let _lastGoodCurrencies = null;

/**
 * Retry wrapper cho Yahoo Finance calls
 * @param {Function} fn - async function to retry
 * @param {number} retries - số lần retry
 * @param {number} delay - delay giữa các lần retry (ms)
 */
async function withRetry(fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i < retries - 1) {
        console.log(`   🔄 Retry ${i + 1}/${retries} sau ${delay/1000}s... (${error.message?.substring(0, 80)})`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 1.5; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
}

// ─── SYMBOLS CONFIG ────────────────────────────────────────

/**
 * Chỉ số thị trường toàn cầu
 */
const GLOBAL_INDICES = [
  { symbol: '^GSPC',     name: 'S&P 500',       region: '🇺🇸 Mỹ',       sector: 'Tổng hợp' },
  { symbol: '^IXIC',     name: 'NASDAQ',         region: '🇺🇸 Mỹ',       sector: 'Công nghệ' },
  { symbol: '^DJI',      name: 'Dow Jones',      region: '🇺🇸 Mỹ',       sector: 'Blue-chip' },
  { symbol: '^RUT',      name: 'Russell 2000',   region: '🇺🇸 Mỹ',       sector: 'Small-cap' },
  { symbol: '^N225',     name: 'Nikkei 225',     region: '🇯🇵 Nhật',     sector: 'Tổng hợp' },
  { symbol: '000001.SS', name: 'Shanghai',       region: '🇨🇳 Trung Quốc', sector: 'Tổng hợp' },
  { symbol: '^HSI',      name: 'Hang Seng',      region: '🇭🇰 Hồng Kông', sector: 'Tổng hợp' },
  { symbol: '^KS11',     name: 'KOSPI',          region: '🇰🇷 Hàn Quốc', sector: 'Tổng hợp' },
  { symbol: '^JKSE',     name: 'Jakarta (IDX)',   region: '🇮🇩 Indonesia', sector: 'Tổng hợp' },
  { symbol: '^SET.BK',   name: 'SET Index',       region: '🇹🇭 Thái Lan',  sector: 'Tổng hợp' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50',  region: '🇪🇺 Châu Âu',  sector: 'Tổng hợp' },
  { symbol: '^FTSE',     name: 'FTSE 100',       region: '🇬🇧 Anh',      sector: 'Tổng hợp' },
];

/**
 * ETF ngành Mỹ → mapping sang nhóm ngành VN tương ứng
 */
const SECTOR_ETFS = [
  { symbol: 'XLF',  name: 'Financial',      vnSector: 'Ngân hàng',       vnStocks: 'VCB, BID, MBB, TCB, VPB, CTG, STB' },
  { symbol: 'XLK',  name: 'Technology',      vnSector: 'Công nghệ',       vnStocks: 'FPT, CMG' },
  { symbol: 'XLY',  name: 'Consumer Disc.',  vnSector: 'Tiêu dùng tùy ý', vnStocks: 'MWG, PNJ' },
  { symbol: 'XLP',  name: 'Consumer Staples',vnSector: 'Tiêu dùng TY',    vnStocks: 'VNM, MSN, SAB' },
  { symbol: 'XLB',  name: 'Materials',       vnSector: 'Vật liệu/Thép',   vnStocks: 'HPG, HSG, NKG' },
  { symbol: 'XLE',  name: 'Energy',          vnSector: 'Năng lượng',       vnStocks: 'GAS, PLX, POW, PVD' },
  { symbol: 'XLV',  name: 'Healthcare',      vnSector: 'Y tế/Dược',       vnStocks: 'DHG, DMC, IMP' },
  { symbol: 'XLRE', name: 'Real Estate',     vnSector: 'Bất động sản',    vnStocks: 'VIC, VHM, NLG, KDH, PDR' },
  { symbol: 'XLI',  name: 'Industrials',     vnSector: 'Công nghiệp',     vnStocks: 'CTR, REE, GEX' },
  { symbol: 'XLU',  name: 'Utilities',       vnSector: 'Tiện ích',         vnStocks: 'POW, NT2, PC1' },
];

/**
 * Tỷ giá & Commodities quan trọng
 */
const CURRENCIES_COMMODITIES = [
  { symbol: 'DX-Y.NYB',  name: 'Dollar Index (DXY)', type: 'currency' },
  { symbol: 'GC=F',      name: 'Vàng (Gold)',         type: 'commodity' },
  { symbol: 'CL=F',      name: 'Dầu WTI',            type: 'commodity' },
  { symbol: '^VIX',      name: 'VIX (Fear Index)',    type: 'volatility' },
  { symbol: 'BTC-USD',   name: 'Bitcoin',             type: 'crypto' },
];

// ─── MAIN FUNCTIONS ─────────────────────────────────────────

/**
 * Lấy dữ liệu chỉ số toàn cầu
 * @returns {Array} Danh sách chỉ số với giá + % thay đổi
 */
async function fetchGlobalIndices() {
  console.log('\n🌍 Đang lấy dữ liệu TTCK quốc tế...');
  const results = [];
  const symbols = GLOBAL_INDICES.map(i => i.symbol);
  
  try {
    const quotes = await withRetry(
      () => yahooFinance.quote(symbols, {}, { validateResult: false }),
      3, 2000
    );
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    for (const idx of GLOBAL_INDICES) {
      const quote = quotesArray.find(q => q && q.symbol === idx.symbol);
      if (quote) {
        const price = quote.regularMarketPrice || 0;
        const change = quote.regularMarketChange || 0;
        const changePct = quote.regularMarketChangePercent || 0;
        const prevClose = quote.regularMarketPreviousClose || 0;
        const open = quote.regularMarketOpen || 0;
        const high = quote.regularMarketDayHigh || 0;
        const low = quote.regularMarketDayLow || 0;
        const volume = quote.regularMarketVolume || 0;
        const marketState = quote.marketState || 'UNKNOWN';

        results.push({
          ...idx,
          price, change,
          changePct: parseFloat(changePct.toFixed(2)),
          prevClose, open, high, low, volume, marketState,
        });

        const sign = changePct >= 0 ? '+' : '';
        const icon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
        console.log(`   ${icon} ${idx.name}: ${price.toLocaleString()} (${sign}${changePct.toFixed(2)}%)`);
      } else {
        console.log(`   ⚠️ ${idx.name}: Không lấy được dữ liệu`);
        results.push({ ...idx, price: 0, change: 0, changePct: 0, error: true });
      }
    }
  } catch (error) {
    console.error('   ❌ Lỗi lấy global indices:', error.message);
    // Fallback: fetch từng cái
    for (const idx of GLOBAL_INDICES) {
      try {
        const quote = await withRetry(
          () => yahooFinance.quote(idx.symbol, {}, { validateResult: false }),
          2, 1500
        );
        if (quote) {
          results.push({
            ...idx,
            price: quote.regularMarketPrice || 0,
            change: quote.regularMarketChange || 0,
            changePct: parseFloat((quote.regularMarketChangePercent || 0).toFixed(2)),
            prevClose: quote.regularMarketPreviousClose || 0,
            open: quote.regularMarketOpen || 0,
            high: quote.regularMarketDayHigh || 0,
            low: quote.regularMarketDayLow || 0,
            volume: quote.regularMarketVolume || 0,
            marketState: quote.marketState || 'UNKNOWN',
          });
        }
      } catch (e) {
        console.error(`   ⚠️ ${idx.name}: ${e.message}`);
        results.push({ ...idx, price: 0, changePct: 0, error: true });
      }
    }
  }

  const successCount = results.filter(r => !r.error).length;
  console.log(`   ✅ Lấy được ${successCount}/${GLOBAL_INDICES.length} chỉ số`);
  
  // Cache nếu lấy được data
  if (successCount > 0) {
    _lastGoodIndices = results;
  } else if (_lastGoodIndices) {
    console.log('   💾 Dùng cache indices từ lần lấy trước');
    return _lastGoodIndices;
  }
  
  return results;
}

/**
 * Lấy dữ liệu ETF ngành Mỹ
 * @returns {Array} Danh sách ETF với giá + % thay đổi
 */
async function fetchSectorETFs() {
  console.log('\n🏦 Đang lấy ETF ngành Mỹ...');
  const results = [];
  const symbols = SECTOR_ETFS.map(e => e.symbol);

  try {
    const quotes = await withRetry(
      () => yahooFinance.quote(symbols, {}, { validateResult: false }),
      3, 2000
    );
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    for (const etf of SECTOR_ETFS) {
      const quote = quotesArray.find(q => q && q.symbol === etf.symbol);
      if (quote) {
        const changePct = quote.regularMarketChangePercent || 0;
        results.push({
          ...etf,
          price: quote.regularMarketPrice || 0,
          change: quote.regularMarketChange || 0,
          changePct: parseFloat(changePct.toFixed(2)),
          volume: quote.regularMarketVolume || 0,
        });
        const sign = changePct >= 0 ? '+' : '';
        const icon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
        console.log(`   ${icon} ${etf.name} (${etf.symbol}): ${sign}${changePct.toFixed(2)}% → VN: ${etf.vnStocks}`);
      }
    }
  } catch (error) {
    console.error('   ❌ Lỗi lấy ETF batch:', error.message);
    // Fallback one-by-one with retry
    for (const etf of SECTOR_ETFS) {
      try {
        const quote = await withRetry(
          () => yahooFinance.quote(etf.symbol, {}, { validateResult: false }),
          2, 1500
        );
        if (quote) {
          results.push({
            ...etf,
            price: quote.regularMarketPrice || 0,
            change: quote.regularMarketChange || 0,
            changePct: parseFloat((quote.regularMarketChangePercent || 0).toFixed(2)),
            volume: quote.regularMarketVolume || 0,
          });
        }
      } catch (e) {
        console.error(`   ⚠️ ETF ${etf.symbol}: ${e.message}`);
      }
    }
  }

  const successCount = results.length;
  console.log(`   ✅ Lấy được ${successCount}/${SECTOR_ETFS.length} ETF ngành`);

  // Cache nếu lấy được data
  if (successCount > 0) {
    _lastGoodETFs = results;
  } else if (_lastGoodETFs) {
    console.log('   💾 Dùng cache ETFs từ lần lấy trước');
    return _lastGoodETFs;
  }

  return results;
}

/**
 * Lấy tỷ giá & commodities
 * @returns {Array}
 */
async function fetchCurrenciesAndCommodities() {
  console.log('\n💱 Đang lấy tỷ giá & hàng hóa...');
  const results = [];

  for (const item of CURRENCIES_COMMODITIES) {
    try {
      const quote = await withRetry(
        () => yahooFinance.quote(item.symbol, {}, { validateResult: false }),
        2, 1500
      );
      if (quote) {
        const changePct = quote.regularMarketChangePercent || 0;
        results.push({
          ...item,
          price: quote.regularMarketPrice || 0,
          change: quote.regularMarketChange || 0,
          changePct: parseFloat(changePct.toFixed(2)),
        });
        const sign = changePct >= 0 ? '+' : '';
        const icon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
        console.log(`   ${icon} ${item.name}: ${quote.regularMarketPrice?.toLocaleString() || 'N/A'} (${sign}${changePct.toFixed(2)}%)`);
      }
    } catch (error) {
      console.error(`   ⚠️ ${item.name}: ${error.message}`);
      results.push({ ...item, price: 0, changePct: 0, error: true });
    }
  }

  const successCount = results.filter(r => !r.error).length;
  // Cache nếu lấy được data
  if (successCount > 0) {
    _lastGoodCurrencies = results;
  } else if (_lastGoodCurrencies) {
    console.log('   💾 Dùng cache currencies từ lần lấy trước');
    return _lastGoodCurrencies;
  }

  return results;
}

/**
 * Lấy toàn bộ dữ liệu TTCK quốc tế
 * @returns {Object} { indices, sectorETFs, currencies, summary }
 */
async function fetchAllGlobalData() {
  const startTime = Date.now();

  // Fetch TUẦN TỰ với delay để tránh Yahoo rate-limit trên server
  const indices = await fetchGlobalIndices();
  await new Promise(r => setTimeout(r, 1500)); // delay 1.5s

  const sectorETFs = await fetchSectorETFs();
  await new Promise(r => setTimeout(r, 1500)); // delay 1.5s

  const currencies = await fetchCurrenciesAndCommodities();

  // Tính Fear/Greed indicators
  const fearGreed = calculateFearGreedIndicators(indices, currencies);

  // Build summary
  const summary = buildGlobalSummary(indices, sectorETFs, currencies, fearGreed);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Hoàn thành lấy data quốc tế (${elapsed}s)`);

  // Log data quality
  const idxOK = indices.filter(i => !i.error).length;
  const etfOK = sectorETFs.length;
  const curOK = currencies.filter(c => !c.error).length;
  console.log(`   📊 Data quality: Indices ${idxOK}/${indices.length} | ETFs ${etfOK} | Currencies ${curOK}/${currencies.length}`);

  return {
    indices,
    sectorETFs,
    currencies,
    fearGreed,
    summary,
    fetchTime: new Date().toISOString(),
  };
}

// ─── FEAR/GREED INDICATORS ─────────────────────────────────

/**
 * Tính chỉ số Fear/Greed dựa trên multi-factor
 * @returns {Object} { score: 0-100, label, factors }
 */
function calculateFearGreedIndicators(indices, currencies) {
  let score = 50; // Trung tính
  const factors = [];

  // Factor 1: S&P 500 performance
  const sp500 = indices.find(i => i.symbol === '^GSPC');
  if (sp500 && !sp500.error) {
    if (sp500.changePct > 1.5) { score += 15; factors.push('🟢 S&P 500 tăng mạnh (+15)'); }
    else if (sp500.changePct > 0.5) { score += 8; factors.push('🟢 S&P 500 tăng nhẹ (+8)'); }
    else if (sp500.changePct < -1.5) { score -= 15; factors.push('🔴 S&P 500 giảm mạnh (-15)'); }
    else if (sp500.changePct < -0.5) { score -= 8; factors.push('🔴 S&P 500 giảm nhẹ (-8)'); }
    else { factors.push('🟡 S&P 500 sideway (0)'); }
  }

  // Factor 2: NASDAQ (tech sentiment)
  const nasdaq = indices.find(i => i.symbol === '^IXIC');
  if (nasdaq && !nasdaq.error) {
    if (nasdaq.changePct > 2) { score += 10; factors.push('🟢 NASDAQ tăng mạnh (+10)'); }
    else if (nasdaq.changePct < -2) { score -= 10; factors.push('🔴 NASDAQ giảm mạnh (-10)'); }
  }

  // Factor 3: Asian markets (ảnh hưởng trực tiếp VN)
  const asianIndices = indices.filter(i =>
    ['^N225', '000001.SS', '^HSI', '^KS11'].includes(i.symbol) && !i.error
  );
  if (asianIndices.length > 0) {
    const asianAvg = asianIndices.reduce((sum, i) => sum + i.changePct, 0) / asianIndices.length;
    if (asianAvg > 1) { score += 12; factors.push(`🟢 Châu Á tăng TB ${asianAvg.toFixed(2)}% (+12)`); }
    else if (asianAvg > 0) { score += 5; factors.push(`🟢 Châu Á tăng nhẹ ${asianAvg.toFixed(2)}% (+5)`); }
    else if (asianAvg < -1) { score -= 12; factors.push(`🔴 Châu Á giảm TB ${asianAvg.toFixed(2)}% (-12)`); }
    else if (asianAvg < 0) { score -= 5; factors.push(`🔴 Châu Á giảm nhẹ ${asianAvg.toFixed(2)}% (-5)`); }
  }

  // Factor 4: VIX (Fear Index)
  const vix = currencies.find(c => c.symbol === '^VIX');
  if (vix && !vix.error) {
    if (vix.price > 30) { score -= 15; factors.push(`🔴 VIX rất cao ${vix.price} → Panic (-15)`); }
    else if (vix.price > 25) { score -= 10; factors.push(`🔴 VIX cao ${vix.price} → Sợ hãi (-10)`); }
    else if (vix.price > 20) { score -= 5; factors.push(`🟠 VIX tăng ${vix.price} → Thận trọng (-5)`); }
    else if (vix.price < 15) { score += 5; factors.push(`🟢 VIX thấp ${vix.price} → Tham lam (+5)`); }
    else { factors.push(`🟡 VIX bình thường ${vix.price} (0)`); }
  }

  // Factor 5: DXY (Dollar Index) - DXY tăng → xấu cho EM/VN
  const dxy = currencies.find(c => c.symbol === 'DX-Y.NYB');
  if (dxy && !dxy.error) {
    if (dxy.changePct > 0.5) { score -= 8; factors.push(`🔴 USD mạnh lên DXY +${dxy.changePct}% (-8)`); }
    else if (dxy.changePct < -0.5) { score += 8; factors.push(`🟢 USD yếu đi DXY ${dxy.changePct}% (+8)`); }
  }

  // Factor 6: Gold (safe haven)
  const gold = currencies.find(c => c.symbol === 'GC=F');
  if (gold && !gold.error) {
    if (gold.changePct > 1.5) { score -= 5; factors.push(`🟠 Vàng tăng mạnh +${gold.changePct}% → risk-off (-5)`); }
    else if (gold.changePct < -1) { score += 3; factors.push(`🟢 Vàng giảm → risk-on (+3)`); }
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));

  // Label
  let label, emoji;
  if (score >= 80) { label = 'CỰC KỲ THAM LAM'; emoji = '🟢🟢'; }
  else if (score >= 65) { label = 'THAM LAM'; emoji = '🟢'; }
  else if (score >= 50) { label = 'TRUNG TÍNH'; emoji = '🟡'; }
  else if (score >= 35) { label = 'SỢ HÃI'; emoji = '🔴'; }
  else { label = 'CỰC KỲ SỢ HÃI'; emoji = '🔴🔴'; }

  return { score, label, emoji, factors };
}

// ─── SUMMARY BUILDER ───────────────────────────────────────

/**
 * Build tổng hợp text cho AI prompt
 */
function buildGlobalSummary(indices, sectorETFs, currencies, fearGreed) {
  let summary = '';

  // Indices
  summary += 'CHỈ SỐ THỊ TRƯỜNG QUỐC TẾ:\n';
  for (const idx of indices.filter(i => !i.error)) {
    const sign = idx.changePct >= 0 ? '+' : '';
    summary += `  ${idx.region} ${idx.name}: ${idx.price.toLocaleString()} (${sign}${idx.changePct}%) | KL: ${formatBigVol(idx.volume)}\n`;
  }

  // Sector ETFs
  summary += '\nETF NGÀNH MỸ (ẢNH HƯỞNG VN):\n';
  for (const etf of sectorETFs) {
    const sign = etf.changePct >= 0 ? '+' : '';
    summary += `  ${etf.name} (${etf.symbol}): ${sign}${etf.changePct}% → VN: ${etf.vnSector} (${etf.vnStocks})\n`;
  }

  // Currencies & Commodities
  summary += '\nTỶ GIÁ & HÀNG HÓA:\n';
  for (const c of currencies.filter(c => !c.error)) {
    const sign = c.changePct >= 0 ? '+' : '';
    summary += `  ${c.name}: ${c.price.toLocaleString()} (${sign}${c.changePct}%)\n`;
  }

  // Fear/Greed
  summary += `\nCHỈ SỐ FEAR/GREED: ${fearGreed.score}/100 (${fearGreed.label})\n`;
  summary += `Factors:\n`;
  for (const f of fearGreed.factors) {
    summary += `  ${f}\n`;
  }

  return summary;
}

/**
 * Build Telegram message cho báo cáo TTCK quốc tế
 */
function buildGlobalMarketTelegramMessage(globalData) {
  const { indices, sectorETFs, currencies, fearGreed } = globalData;
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  let msg = `🌍 <b>BÁO CÁO TTCK QUỐC TẾ</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Fear/Greed Score
  msg += `${fearGreed.emoji} <b>FEAR/GREED: ${fearGreed.score}/100 (${fearGreed.label})</b>\n\n`;

  // ─── Global Indices ───
  msg += `📊 <b>CHỈ SỐ CHÍNH</b>\n`;

  // Group by region
  const usIndices = indices.filter(i => i.region.includes('Mỹ') && !i.error);
  const asiaIndices = indices.filter(i => (i.region.includes('Nhật') || i.region.includes('Trung') || i.region.includes('Hồng') || i.region.includes('Hàn')) && !i.error);
  const euroIndices = indices.filter(i => (i.region.includes('Âu') || i.region.includes('Anh')) && !i.error);

  if (usIndices.length === 0 && asiaIndices.length === 0 && euroIndices.length === 0) {
    msg += `\n⚠️ <i>Dữ liệu chỉ số tạm thời không khả dụng. Thử lại sau.</i>\n`;
  }

  if (usIndices.length > 0) {
    msg += `\n🇺🇸 <b>Mỹ:</b>\n`;
    for (const idx of usIndices) {
      const icon = idx.changePct > 0 ? '🟢' : idx.changePct < 0 ? '🔴' : '🟡';
      const sign = idx.changePct >= 0 ? '+' : '';
      msg += `${icon} <b>${idx.name}</b>: ${idx.price.toLocaleString('en-US', {maximumFractionDigits: 2})} (${sign}${idx.changePct}%)\n`;
    }
  }

  if (asiaIndices.length > 0) {
    msg += `\n🌏 <b>Châu Á:</b>\n`;
    for (const idx of asiaIndices) {
      const icon = idx.changePct > 0 ? '🟢' : idx.changePct < 0 ? '🔴' : '🟡';
      const sign = idx.changePct >= 0 ? '+' : '';
      msg += `${icon} <b>${idx.name}</b>: ${idx.price.toLocaleString('en-US', {maximumFractionDigits: 2})} (${sign}${idx.changePct}%)\n`;
    }
  }

  if (euroIndices.length > 0) {
    msg += `\n🇪🇺 <b>Châu Âu:</b>\n`;
    for (const idx of euroIndices) {
      const icon = idx.changePct > 0 ? '🟢' : idx.changePct < 0 ? '🔴' : '🟡';
      const sign = idx.changePct >= 0 ? '+' : '';
      msg += `${icon} <b>${idx.name}</b>: ${idx.price.toLocaleString('en-US', {maximumFractionDigits: 2})} (${sign}${idx.changePct}%)\n`;
    }
  }

  // ─── Sector ETFs ───
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏦 <b>ETF NGÀNH → ẢNH HƯỞNG VN</b>\n\n`;

  // Sort by changePct
  const sortedETFs = [...sectorETFs].sort((a, b) => b.changePct - a.changePct);
  if (sortedETFs.length === 0) {
    msg += `⚠️ <i>Dữ liệu ETF tạm thời không khả dụng.</i>\n`;
  }
  for (const etf of sortedETFs) {
    const icon = etf.changePct > 0 ? '🟢' : etf.changePct < 0 ? '🔴' : '🟡';
    const sign = etf.changePct >= 0 ? '+' : '';
    msg += `${icon} <b>${etf.vnSector}</b> (${etf.symbol} ${sign}${etf.changePct}%)\n`;
    msg += `   → ${etf.vnStocks}\n`;
  }

  // ─── Currencies & Commodities ───
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💱 <b>TỶ GIÁ & HÀNG HÓA</b>\n\n`;

  const validCurrencies = currencies.filter(c => !c.error);
  if (validCurrencies.length === 0) {
    msg += `⚠️ <i>Dữ liệu tỷ giá tạm thời không khả dụng.</i>\n`;
  }
  for (const c of validCurrencies) {
    const icon = c.changePct > 0 ? '🟢' : c.changePct < 0 ? '🔴' : '🟡';
    const sign = c.changePct >= 0 ? '+' : '';
    msg += `${icon} <b>${c.name}</b>: ${c.price.toLocaleString('en-US', {maximumFractionDigits: 2})} (${sign}${c.changePct}%)\n`;
  }

  // ─── Quick Interpretation ───
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🔮 <b>TÍN HIỆU NHANH CHO VN</b>\n\n`;

  // US market signal
  const sp500 = indices.find(i => i.symbol === '^GSPC');
  if (sp500 && !sp500.error) {
    if (sp500.changePct > 1) msg += `🟢 Mỹ tăng mạnh → VN có thể <b>GAP UP mở cửa</b>\n`;
    else if (sp500.changePct > 0) msg += `🟢 Mỹ tăng nhẹ → VN thiên hướng <b>TÍCH CỰC</b>\n`;
    else if (sp500.changePct < -1) msg += `🔴 Mỹ giảm mạnh → VN nguy cơ <b>GAP DOWN</b>\n`;
    else if (sp500.changePct < 0) msg += `🔴 Mỹ giảm nhẹ → VN áp lực <b>ĐIỀU CHỈNH</b>\n`;
    else msg += `🟡 Mỹ sideway → VN <b>PHÂN HÓA</b>\n`;
  }

  // Sector signal
  const topSector = sortedETFs[0];
  const botSector = sortedETFs[sortedETFs.length - 1];
  if (topSector && topSector.changePct > 0.5) {
    msg += `📈 Ngành nóng: <b>${topSector.vnSector}</b> (${topSector.symbol} +${topSector.changePct}%) → ${topSector.vnStocks}\n`;
  }
  if (botSector && botSector.changePct < -0.5) {
    msg += `📉 Ngành yếu: <b>${botSector.vnSector}</b> (${botSector.symbol} ${botSector.changePct}%) → ${botSector.vnStocks}\n`;
  }

  // VIX signal
  const vix = currencies.find(c => c.symbol === '^VIX');
  if (vix && !vix.error) {
    if (vix.price > 25) msg += `⚠️ VIX = ${vix.price} (CAO) → Thị trường lo ngại, <b>THẬN TRỌNG</b>\n`;
    else if (vix.price < 15) msg += `✅ VIX = ${vix.price} (THẤP) → Thị trường bình ổn\n`;
  }

  msg += `\n<i>⏳ AI đang phân tích chi tiết ảnh hưởng VN...</i>`;

  return msg;
}

// ─── HELPERS ───────────────────────────────────────────────

function formatBigVol(vol) {
  if (!vol) return '0';
  if (vol >= 1000000000) return (vol / 1000000000).toFixed(2) + 'B';
  if (vol >= 1000000) return (vol / 1000000).toFixed(2) + 'M';
  if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
  return vol.toLocaleString();
}

// ─── JOB 21h MỚI: FETCH ĐƠN GIẢN + GIÁ VÀNG ──────────────────

/**
 * Fetch chỉ số quốc tế (đơn giản, không ETF/Fear-Greed)
 * Dùng cho báo cáo 21h hàng ngày
 */
async function fetchGlobalIndicesSimple() {
  console.log('\n🌍 Lấy dữ liệu TTCK quốc tế (đơn giản)...');
  const results = [];
  const symbols = GLOBAL_INDICES.map(i => i.symbol);

  try {
    const quotes = await withRetry(
      () => yahooFinance.quote(symbols, {}, { validateResult: false }),
      3, 2000
    );
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    for (const idx of GLOBAL_INDICES) {
      const quote = quotesArray.find(q => q && q.symbol === idx.symbol);
      if (quote) {
        const changePct = quote.regularMarketChangePercent || 0;
        results.push({
          ...idx,
          price: quote.regularMarketPrice || 0,
          change: quote.regularMarketChange || 0,
          changePct: parseFloat(changePct.toFixed(2)),
          marketState: quote.marketState || 'UNKNOWN',
        });
        const sign = changePct >= 0 ? '+' : '';
        const icon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
        console.log(`   ${icon} ${idx.name}: ${(quote.regularMarketPrice || 0).toLocaleString()} (${sign}${changePct.toFixed(2)}%)`);
      } else {
        results.push({ ...idx, price: 0, change: 0, changePct: 0, error: true });
        console.log(`   ⚠️ ${idx.name}: Không lấy được dữ liệu`);
      }
    }
  } catch (error) {
    console.error('   ❌ Lỗi lấy global indices:', error.message);
    // Fallback: fetch từng cái
    for (const idx of GLOBAL_INDICES) {
      try {
        const quote = await withRetry(
          () => yahooFinance.quote(idx.symbol, {}, { validateResult: false }),
          2, 1500
        );
        if (quote) {
          results.push({
            ...idx,
            price: quote.regularMarketPrice || 0,
            change: quote.regularMarketChange || 0,
            changePct: parseFloat((quote.regularMarketChangePercent || 0).toFixed(2)),
            marketState: quote.marketState || 'UNKNOWN',
          });
        }
      } catch (e) {
        console.error(`   ⚠️ ${idx.name}: ${e.message}`);
        results.push({ ...idx, price: 0, changePct: 0, error: true });
      }
    }
  }

  console.log(`   ✅ Lấy được ${results.filter(r => !r.error).length}/${GLOBAL_INDICES.length} chỉ số`);
  return results;
}

/**
 * Fetch giá vàng thế giới (Yahoo Finance) + giá vàng Việt Nam (BTMC API)
 * Bao gồm: 1 lượng, 1 chỉ, vàng nhẫn, tỷ lệ tăng/giảm
 * @returns {Object} { world: {...}, vietnam: {...} }
 */
async function fetchGoldPrices() {
  console.log('\n🥇 Lấy giá vàng...');
  const result = { world: null, vietnam: null };

  // 1. Vàng thế giới từ Yahoo Finance
  try {
    const goldQuote = await withRetry(
      () => yahooFinance.quote('GC=F', {}, { validateResult: false }),
      2, 1500
    );
    if (goldQuote) {
      const changePct = goldQuote.regularMarketChangePercent || 0;
      result.world = {
        price: goldQuote.regularMarketPrice || 0,
        change: goldQuote.regularMarketChange || 0,
        changePct: parseFloat(changePct.toFixed(2)),
        currency: 'USD/oz',
      };
      const sign = changePct >= 0 ? '+' : '';
      const icon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
      console.log(`   ${icon} Vàng TG: $${(result.world.price || 0).toLocaleString()} (${sign}${changePct.toFixed(2)}%)`);
    }
  } catch (error) {
    console.error('   ⚠️ Lỗi lấy giá vàng TG:', error.message);
  }

  // Lấy % thay đổi vàng TG làm tham chiếu cho VN
  const worldGoldChangePct = result.world ? result.world.changePct : 0;

  // 2. Vàng Việt Nam từ BTMC (Bảo Tín Minh Châu) API
  try {
    const axios = require('axios');
    const btmcResponse = await axios.get('https://www.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45ber1', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (btmcResponse.data && btmcResponse.data.DataList && btmcResponse.data.DataList.Data) {
      const goldItems = btmcResponse.data.DataList.Data;

      let sjc1Luong = null;
      let vangNhan1Chi = null;

      for (const item of goldItems) {
        const rows = item.DataList?.Data || [];
        for (const row of rows) {
          const name = (row['@n'] || row['@key'] || '').toLowerCase();
          if (!sjc1Luong && (name.includes('sjc') || name.includes('1l') || name.includes('1 lượng'))) {
            sjc1Luong = {
              buy: parseFloat(row['@pb'] || 0) * 1000,
              sell: parseFloat(row['@ps'] || 0) * 1000,
              name: row['@n'] || 'SJC 1L',
            };
          }
          if (!vangNhan1Chi && (name.includes('nhẫn') || name.includes('1 chỉ') || name.includes('1c'))) {
            vangNhan1Chi = {
              buy: parseFloat(row['@pb'] || 0) * 1000,
              sell: parseFloat(row['@ps'] || 0) * 1000,
              name: row['@n'] || 'Nhẫn 1 chỉ',
            };
          }
        }
      }

      // Fallback: lấy item đầu tiên nếu không tìm thấy
      if (!sjc1Luong && goldItems.length > 0) {
        const firstGroup = goldItems[0];
        const firstRows = firstGroup.DataList?.Data || [];
        if (firstRows.length > 0) {
          const row = firstRows[0];
          sjc1Luong = {
            buy: parseFloat(row['@pb'] || 0) * 1000,
            sell: parseFloat(row['@ps'] || 0) * 1000,
            name: row['@n'] || 'Vàng miếng',
          };
        }
      }

      // Tính giá 1 chỉ = 1 lượng / 10
      let vang1Chi = null;
      if (sjc1Luong && sjc1Luong.buy > 0) {
        vang1Chi = {
          buy: Math.round(sjc1Luong.buy / 10),
          sell: Math.round(sjc1Luong.sell / 10),
          name: 'SJC 1 chỉ',
        };
      }

      result.vietnam = {
        sjc1Luong,
        vang1Chi,
        vangNhan1Chi,
        changePct: worldGoldChangePct,
        source: 'BTMC',
      };

      if (sjc1Luong) console.log(`   🇻🇳 ${sjc1Luong.name}: Mua ${sjc1Luong.buy?.toLocaleString('vi-VN')}đ | Bán ${sjc1Luong.sell?.toLocaleString('vi-VN')}đ`);
      if (vang1Chi) console.log(`   🇻🇳 ${vang1Chi.name}: Mua ${vang1Chi.buy?.toLocaleString('vi-VN')}đ | Bán ${vang1Chi.sell?.toLocaleString('vi-VN')}đ`);
      if (vangNhan1Chi) console.log(`   🇻🇳 ${vangNhan1Chi.name}: Mua ${vangNhan1Chi.buy?.toLocaleString('vi-VN')}đ | Bán ${vangNhan1Chi.sell?.toLocaleString('vi-VN')}đ`);
    }
  } catch (error) {
    console.error('   ⚠️ Lỗi lấy giá vàng VN:', error.message);
    // Fallback: dùng giá vàng TG quy đổi
    if (result.world) {
      const usdVnd = 25500;
      const troyOzToLuong = 1.20565;
      const pricePerLuong = result.world.price * usdVnd * troyOzToLuong;
      const pricePerChi = pricePerLuong / 10;
      result.vietnam = {
        sjc1Luong: {
          buy: Math.round(pricePerLuong / 1000) * 1000,
          sell: Math.round(pricePerLuong * 1.01 / 1000) * 1000,
          name: 'Vàng quy đổi TG (ước)',
        },
        vang1Chi: {
          buy: Math.round(pricePerChi / 1000) * 1000,
          sell: Math.round(pricePerChi * 1.01 / 1000) * 1000,
          name: 'Vàng 1 chỉ (ước)',
        },
        vangNhan1Chi: null,
        changePct: worldGoldChangePct,
        source: 'Quy đổi từ giá TG',
      };
    }
  }

  return result;
}

/**
 * Build Telegram message cho báo cáo 21h hàng ngày
 * TTCK quốc tế + Giá vàng
 */
function buildDailyGlobalSummaryMessage(indices, goldData, now) {
  let msg = `🌍 <b>BÁO CÁO TTCK QUỐC TẾ & GIÁ VÀNG</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // ─── TTCK Quốc tế ───
  const validIndices = indices.filter(i => !i.error);

  // Group by region
  const regions = [
    { label: '🇺🇸 <b>Mỹ</b>', filter: i => i.region.includes('Mỹ') },
    { label: '🌏 <b>Châu Á</b>', filter: i => ['Nhật', 'Trung', 'Hồng', 'Hàn', 'Indo', 'Thái'].some(k => i.region.includes(k)) },
    { label: '🇪🇺 <b>Châu Âu</b>', filter: i => ['Châu Âu', 'Anh'].some(k => i.region.includes(k)) },
  ];

  msg += `📊 <b>TTCK QUỐC TẾ</b>\n`;

  for (const region of regions) {
    const regionIndices = validIndices.filter(region.filter);
    if (regionIndices.length === 0) continue;

    msg += `\n${region.label}:\n`;
    for (const idx of regionIndices) {
      const icon = idx.changePct > 0 ? '🟢' : idx.changePct < 0 ? '🔴' : '🟡';
      const sign = idx.changePct >= 0 ? '+' : '';
      msg += `${icon} <b>${idx.name}</b>: ${idx.price.toLocaleString('en-US', {maximumFractionDigits: 2})} (${sign}${idx.changePct}%)\n`;
    }
  }

  if (validIndices.length === 0) {
    msg += `\n⚠️ <i>Dữ liệu chỉ số tạm thời không khả dụng.</i>\n`;
  }

  // Tóm tắt nhanh
  const usIndices = validIndices.filter(i => i.region.includes('Mỹ'));
  const asiaIndices = validIndices.filter(i => ['Nhật', 'Trung', 'Hồng', 'Hàn', 'Indo', 'Thái'].some(k => i.region.includes(k)));

  if (usIndices.length > 0) {
    const usAvg = usIndices.reduce((sum, i) => sum + i.changePct, 0) / usIndices.length;
    const usIcon = usAvg > 0 ? '🟢' : usAvg < 0 ? '🔴' : '🟡';
    msg += `\n${usIcon} <b>Mỹ TB:</b> ${usAvg >= 0 ? '+' : ''}${usAvg.toFixed(2)}%`;
  }
  if (asiaIndices.length > 0) {
    const asiaAvg = asiaIndices.reduce((sum, i) => sum + i.changePct, 0) / asiaIndices.length;
    const asiaIcon = asiaAvg > 0 ? '🟢' : asiaAvg < 0 ? '🔴' : '🟡';
    msg += ` | ${asiaIcon} <b>Châu Á TB:</b> ${asiaAvg >= 0 ? '+' : ''}${asiaAvg.toFixed(2)}%`;
  }
  msg += `\n`;

  // ─── Giá Vàng ───
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🥇 <b>GIÁ VÀNG</b>\n\n`;

  // Vàng thế giới
  if (goldData && goldData.world) {
    const g = goldData.world;
    const gIcon = g.changePct > 0 ? '🟢' : g.changePct < 0 ? '🔴' : '🟡';
    const gSign = g.changePct >= 0 ? '+' : '';
    msg += `🌐 <b>Vàng Thế Giới:</b>\n`;
    msg += `${gIcon} $${g.price.toLocaleString('en-US', {maximumFractionDigits: 2})}/oz (${gSign}${g.changePct}%)\n\n`;
  } else {
    msg += `🌐 Vàng TG: <i>Không lấy được dữ liệu</i>\n\n`;
  }

  // Vàng Việt Nam
  if (goldData && goldData.vietnam) {
    const vn = goldData.vietnam;
    const vnChangePct = vn.changePct || 0;
    const vnChangeIcon = vnChangePct > 0 ? '🟢' : vnChangePct < 0 ? '🔴' : '🟡';
    const vnChangeSign = vnChangePct >= 0 ? '+' : '';

    msg += `🇻🇳 <b>Vàng Việt Nam</b> <i>(${vn.source || 'BTMC'})</i>`;
    msg += ` ${vnChangeIcon} ${vnChangeSign}${vnChangePct}%\n`;

    if (vn.sjc1Luong) {
      msg += `💰 <b>${vn.sjc1Luong.name}:</b>\n`;
      msg += `   Mua: <b>${vn.sjc1Luong.buy?.toLocaleString('vi-VN')}đ</b>`;
      msg += ` | Bán: <b>${vn.sjc1Luong.sell?.toLocaleString('vi-VN')}đ</b>\n`;
    }

    if (vn.vang1Chi) {
      msg += `💎 <b>${vn.vang1Chi.name}:</b>\n`;
      msg += `   Mua: <b>${vn.vang1Chi.buy?.toLocaleString('vi-VN')}đ</b>`;
      msg += ` | Bán: <b>${vn.vang1Chi.sell?.toLocaleString('vi-VN')}đ</b>\n`;
    }

    if (vn.vangNhan1Chi) {
      msg += `💍 <b>${vn.vangNhan1Chi.name}:</b>\n`;
      msg += `   Mua: <b>${vn.vangNhan1Chi.buy?.toLocaleString('vi-VN')}đ</b>`;
      msg += ` | Bán: <b>${vn.vangNhan1Chi.sell?.toLocaleString('vi-VN')}đ</b>\n`;
    }
  } else {
    msg += `🇻🇳 Vàng VN: <i>Không lấy được dữ liệu</i>\n`;
  }

  // Footer
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>📰 Cập nhật mỗi ngày lúc 21:00</i>\n`;
  msg += `<i>🤖 VN Stock Bot | TTCK Quốc tế & Vàng</i>`;

  return msg;
}

module.exports = {
  fetchAllGlobalData,
  fetchGlobalIndices,
  fetchSectorETFs,
  fetchCurrenciesAndCommodities,
  buildGlobalMarketTelegramMessage,
  fetchGlobalIndicesSimple,
  fetchGoldPrices,
  buildDailyGlobalSummaryMessage,
  GLOBAL_INDICES,
  SECTOR_ETFS,
};
