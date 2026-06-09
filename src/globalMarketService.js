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

const axios = require('axios');

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
  { symbol: '.SPX',      name: 'S&P 500',       region: '🇺🇸 Mỹ',       sector: 'Tổng hợp' },
  { symbol: '.IXIC',     name: 'NASDAQ',         region: '🇺🇸 Mỹ',       sector: 'Công nghệ' },
  { symbol: '.DJI',      name: 'Dow Jones',      region: '🇺🇸 Mỹ',       sector: 'Blue-chip' },
  { symbol: '.RUT',      name: 'Russell 2000',   region: '🇺🇸 Mỹ',       sector: 'Small-cap' },
  { symbol: '.N225',     name: 'Nikkei 225',     region: '🇯🇵 Nhật',     sector: 'Tổng hợp' },
  { symbol: '.SSEC',     name: 'Shanghai',       region: '🇨🇳 Trung Quốc', sector: 'Tổng hợp' },
  { symbol: '.HSI',      name: 'Hang Seng',      region: '🇭🇰 Hồng Kông', sector: 'Tổng hợp' },
  { symbol: '.KS11',     name: 'KOSPI',          region: '🇰🇷 Hàn Quốc', sector: 'Tổng hợp' },
  { symbol: '.STI',      name: 'Singapore (STI)', region: '🇸🇬 Singapore', sector: 'Tổng hợp' },
  { symbol: '.SETI',     name: 'SET Index',       region: '🇹🇭 Thái Lan',  sector: 'Tổng hợp' },
  { symbol: '.STOXX50E', name: 'Euro Stoxx 50',  region: '🇪🇺 Châu Âu',  sector: 'Tổng hợp' },
  { symbol: '.FTSE',     name: 'FTSE 100',       region: '🇬🇧 Anh',      sector: 'Tổng hợp' },
];

/**
 * ETF ngành Mỹ → mapping sang nhóm ngành VN tương ứng
 */
const SECTOR_ETFS = [
  { symbol: 'XLF',  name: 'Financial',      vnSector: 'Ngân hàng',       vnStocks: 'VCB, BID, MBB, TCB, ACB, VPB, CTG, STB' },
  { symbol: 'XLK',  name: 'Technology',      vnSector: 'Công nghệ',       vnStocks: 'FPT, CMG' },
  { symbol: 'XLY',  name: 'Consumer Disc.',  vnSector: 'Tiêu dùng tùy ý', vnStocks: 'MWG, PNJ' },
  { symbol: 'XLP',  name: 'Consumer Staples',vnSector: 'Tiêu dùng TY',    vnStocks: 'MSN, SAB' },
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
  { symbol: '@DX.1',  name: 'Dollar Index (DXY)', type: 'currency' },
  { symbol: '@GC.1',  name: 'Vàng (Gold)',         type: 'commodity' },
  { symbol: '@CL.1',  name: 'Dầu WTI',            type: 'commodity' },
  { symbol: '.VIX',   name: 'VIX (Fear Index)',    type: 'volatility' },
  { symbol: 'BTC=',   name: 'Bitcoin',             type: 'crypto' },
];

// ─── MAIN FUNCTIONS ─────────────────────────────────────────

/**
 * Lấy dữ liệu chỉ số toàn cầu
 * @returns {Array} Danh sách chỉ số với giá + % thay đổi
 */
async function fetchCNBCQuotes(symbols) {
  try {
    const url = `https://quote.cnbc.com/quote-html-webservice/quote.htm?partnerId=2&requestMethod=quick&symbolType=symbol&symbols=${symbols.join('|')}&exthrs=1&noform=1&fund=1&output=json`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });
    
    if (response.data && response.data.QuickQuoteResult && response.data.QuickQuoteResult.QuickQuote) {
      return response.data.QuickQuoteResult.QuickQuote;
    }
    return [];
  } catch (error) {
    console.error('⚠️  Lỗi khi gọi CNBC API:', error.message);
    return [];
  }
}

async function fetchGlobalIndices() {
  console.log('\n🌍 Đang lấy dữ liệu TTCK quốc tế...');
  const results = [];
  const symbols = GLOBAL_INDICES.map(i => i.symbol);
  
  try {
    const quotes = await withRetry(() => fetchCNBCQuotes(symbols), 3, 2000);
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    for (const idx of GLOBAL_INDICES) {
      const quote = quotesArray.find(q => q && q.symbol === idx.symbol);
      if (quote && quote.last !== undefined) {
        const price = parseFloat(quote.last) || 0;
        const change = parseFloat(quote.change) || 0;
        const changePct = parseFloat(quote.change_pct) || 0;
        const prevClose = parseFloat(quote.previous_close) || 0;
        const open = parseFloat(quote.open) || 0;
        const high = parseFloat(quote.high) || 0;
        const low = parseFloat(quote.low) || 0;
        const volume = parseInt(quote.volume) || 0;

        results.push({
          ...idx,
          price, change,
          changePct: parseFloat(changePct.toFixed(2)),
          prevClose, open, high, low, volume,
          marketState: quote.market_state || 'REGULAR',
        });

        const sign = changePct >= 0 ? '+' : '';
        const icon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
        console.log(`   ${icon} ${idx.name}: ${price.toLocaleString()} (${sign}${changePct.toFixed(2)}%)`);
      } else {
        console.log(`   ⚠️  ${idx.name}: Không lấy được dữ liệu`);
        results.push({ ...idx, price: 0, change: 0, changePct: 0, error: true });
      }
    }
  } catch (error) {
    console.error('   ❌ Lỗi lấy global indices từ CNBC:', error.message);
  }

  const successCount = results.filter(r => !r.error).length;
  console.log(`   ✅ Lấy được ${successCount}/${GLOBAL_INDICES.length} chỉ số`);
  
  if (successCount > 0) {
    _lastGoodIndices = results;
  } else if (_lastGoodIndices) {
    console.log('   💾 Dùng cache indices từ lần lấy trước');
    return _lastGoodIndices;
  }
  
  return results;
}

async function fetchSectorETFs() {
  console.log('\n🏦 Đang lấy ETF ngành Mỹ...');
  const results = [];
  const symbols = SECTOR_ETFS.map(e => e.symbol);

  try {
    const quotes = await withRetry(() => fetchCNBCQuotes(symbols), 3, 2000);
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    for (const etf of SECTOR_ETFS) {
      const quote = quotesArray.find(q => q && q.symbol === etf.symbol);
      if (quote && quote.last !== undefined) {
        const changePct = parseFloat(quote.change_pct) || 0;
        results.push({
          ...etf,
          price: parseFloat(quote.last) || 0,
          change: parseFloat(quote.change) || 0,
          changePct: parseFloat(changePct.toFixed(2)),
          volume: parseInt(quote.volume) || 0,
        });
        const sign = changePct >= 0 ? '+' : '';
        const icon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
        console.log(`   ${icon} ${etf.name} (${etf.symbol}): ${sign}${changePct.toFixed(2)}% → VN: ${etf.vnStocks}`);
      }
    }
  } catch (error) {
    console.error('   ❌ Lỗi lấy ETF từ CNBC:', error.message);
  }

  const successCount = results.length;
  console.log(`   ✅ Lấy được ${successCount}/${SECTOR_ETFS.length} ETF ngành`);

  if (successCount > 0) {
    _lastGoodETFs = results;
  } else if (_lastGoodETFs) {
    console.log('   💾 Dùng cache ETFs từ lần lấy trước');
    return _lastGoodETFs;
  }

  return results;
}

async function fetchCurrenciesAndCommodities() {
  console.log('\n💱 Đang lấy tỷ giá & hàng hóa...');
  const results = [];
  const symbols = CURRENCIES_COMMODITIES.map(c => c.symbol);

  try {
    const quotes = await withRetry(() => fetchCNBCQuotes(symbols), 3, 2000);
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    for (const item of CURRENCIES_COMMODITIES) {
      const quote = quotesArray.find(q => q && q.symbol === item.symbol);
      if (quote && quote.last !== undefined) {
        const changePct = parseFloat(quote.change_pct) || 0;
        const price = parseFloat(quote.last) || 0;
        results.push({
          ...item,
          price,
          change: parseFloat(quote.change) || 0,
          changePct: parseFloat(changePct.toFixed(2)),
        });
        const sign = changePct >= 0 ? '+' : '';
        const icon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
        console.log(`   ${icon} ${item.name}: ${price.toLocaleString()} (${sign}${changePct.toFixed(2)}%)`);
      } else {
        console.log(`   ⚠️  ${item.name}: Không lấy được dữ liệu`);
        results.push({ ...item, price: 0, changePct: 0, error: true });
      }
    }
  } catch (error) {
    console.error('   ❌ Lỗi lấy currencies từ CNBC:', error.message);
  }

  const successCount = results.filter(r => !r.error).length;
  if (successCount > 0) {
    _lastGoodCurrencies = results;
  } else if (_lastGoodCurrencies) {
    console.log('   💾 Dùng cache currencies từ lần lấy trước');
    return _lastGoodCurrencies;
  }

  return results;
}

async function fetchAllGlobalData() {
  const startTime = Date.now();

  const indices = await fetchGlobalIndices();
  await new Promise(r => setTimeout(r, 1000));

  const sectorETFs = await fetchSectorETFs();
  await new Promise(r => setTimeout(r, 1000));

  const currencies = await fetchCurrenciesAndCommodities();

  const fearGreed = calculateFearGreedIndicators(indices, currencies);
  const summary = buildGlobalSummary(indices, sectorETFs, currencies, fearGreed);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Hoàn thành lấy data quốc tế (${elapsed}s)`);

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

function calculateFearGreedIndicators(indices, currencies) {
  let score = 50;
  const factors = [];

  const sp500 = indices.find(i => i.symbol === '.SPX');
  if (sp500 && !sp500.error) {
    if (sp500.changePct > 1.5) { score += 15; factors.push('🟢 S&P 500 tăng mạnh (+15)'); }
    else if (sp500.changePct > 0.5) { score += 8; factors.push('🟢 S&P 500 tăng nhẹ (+8)'); }
    else if (sp500.changePct < -1.5) { score -= 15; factors.push('🔴 S&P 500 giảm mạnh (-15)'); }
    else if (sp500.changePct < -0.5) { score -= 8; factors.push('🔴 S&P 500 giảm nhẹ (-8)'); }
    else { factors.push('🟡 S&P 500 sideway (0)'); }
  }

  const nasdaq = indices.find(i => i.symbol === '.IXIC');
  if (nasdaq && !nasdaq.error) {
    if (nasdaq.changePct > 2) { score += 10; factors.push('🟢 NASDAQ tăng mạnh (+10)'); }
    else if (nasdaq.changePct < -2) { score -= 10; factors.push('🔴 NASDAQ giảm mạnh (-10)'); }
  }

  const asianIndices = indices.filter(i =>
    ['.N225', '.SSEC', '.HSI', '.KS11'].includes(i.symbol) && !i.error
  );
  if (asianIndices.length > 0) {
    const asianAvg = asianIndices.reduce((sum, i) => sum + i.changePct, 0) / asianIndices.length;
    if (asianAvg > 1) { score += 12; factors.push(`🟢 Châu Á tăng TB ${asianAvg.toFixed(2)}% (+12)`); }
    else if (asianAvg > 0) { score += 5; factors.push(`🟢 Châu Á tăng nhẹ ${asianAvg.toFixed(2)}% (+5)`); }
    else if (asianAvg < -1) { score -= 12; factors.push(`🔴 Châu Á giảm TB ${asianAvg.toFixed(2)}% (-12)`); }
    else if (asianAvg < 0) { score -= 5; factors.push(`🔴 Châu Á giảm nhẹ ${asianAvg.toFixed(2)}% (-5)`); }
  }

  const vix = currencies.find(c => c.symbol === '.VIX');
  if (vix && !vix.error) {
    if (vix.price > 30) { score -= 15; factors.push(`🔴 VIX rất cao ${vix.price} → Panic (-15)`); }
    else if (vix.price > 25) { score -= 10; factors.push(`🔴 VIX cao ${vix.price} → Sợ hãi (-10)`); }
    else if (vix.price > 20) { score -= 5; factors.push(`🟠 VIX tăng ${vix.price} → Thận trọng (-5)`); }
    else if (vix.price < 15) { score += 5; factors.push(`🟢 VIX thấp ${vix.price} → Tham lam (+5)`); }
    else { factors.push(`🟡 VIX bình thường ${vix.price} (0)`); }
  }

  const dxy = currencies.find(c => c.symbol === '@DX.1');
  if (dxy && !dxy.error) {
    if (dxy.changePct > 0.5) { score -= 8; factors.push(`🔴 USD mạnh lên DXY +${dxy.changePct}% (-8)`); }
    else if (dxy.changePct < -0.5) { score += 8; factors.push(`🟢 USD yếu đi DXY ${dxy.changePct}% (+8)`); }
  }

  const gold = currencies.find(c => c.symbol === '@GC.1');
  if (gold && !gold.error) {
    if (gold.changePct > 1.5) { score -= 5; factors.push(`🟠 Vàng tăng mạnh +${gold.changePct}% → risk-off (-5)`); }
    else if (gold.changePct < -1) { score += 3; factors.push(`🟢 Vàng giảm → risk-on (+3)`); }
  }

  score = Math.max(0, Math.min(100, score));

  let label, emoji;
  if (score >= 80) { label = 'CỰC KỲ THAM LAM'; emoji = '🟢🟢'; }
  else if (score >= 65) { label = 'THAM LAM'; emoji = '🟢'; }
  else if (score >= 50) { label = 'TRUNG TÍNH'; emoji = '🟡'; }
  else if (score >= 35) { label = 'SỢ HÃI'; emoji = '🔴'; }
  else { label = 'CỰC KỲ SỢ HÃI'; emoji = '🔴🔴'; }

  return { score, label, emoji, factors };
}

function buildGlobalSummary(indices, sectorETFs, currencies, fearGreed) {
  let summary = '';

  summary += 'CHỈ SỐ THỊ TRƯỜNG QUỐC TẾ:\n';
  for (const idx of indices.filter(i => !i.error)) {
    const sign = idx.changePct >= 0 ? '+' : '';
    summary += `  ${idx.region} ${idx.name}: ${idx.price.toLocaleString()} (${sign}${idx.changePct}%) | KL: ${formatBigVol(idx.volume)}\n`;
  }

  summary += '\nETF NGÀNH MỸ (ẢNH HƯỞNG VN):\n';
  for (const etf of sectorETFs) {
    const sign = etf.changePct >= 0 ? '+' : '';
    summary += `  ${etf.name} (${etf.symbol}): ${sign}${etf.changePct}% → VN: ${etf.vnSector} (${etf.vnStocks})\n`;
  }

  summary += '\nTỶ GIÁ & HÀNG HÓA:\n';
  for (const c of currencies.filter(c => !c.error)) {
    const sign = c.changePct >= 0 ? '+' : '';
    summary += `  ${c.name}: ${c.price.toLocaleString()} (${sign}${c.changePct}%)\n`;
  }

  summary += `\nCHỈ SỐ FEAR/GREED: ${fearGreed.score}/100 (${fearGreed.label})\n`;
  summary += `Factors:\n`;
  for (const f of fearGreed.factors) {
    summary += `  ${f}\n`;
  }

  return summary;
}

function buildGlobalMarketTelegramMessage(globalData) {
  const { indices, sectorETFs, currencies, fearGreed } = globalData;
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  let msg = `🌍 <b>BÁO CÁO TTCK QUỐC TẾ</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `${fearGreed.emoji} <b>FEAR/GREED: ${fearGreed.score}/100 (${fearGreed.label})</b>\n\n`;

  msg += `📊 <b>CHỈ SỐ CHÍNH</b>\n`;

  const usIndices = indices.filter(i => i.region.includes('Mỹ') && !i.error);
  const asiaIndices = indices.filter(i => (i.region.includes('Nhật') || i.region.includes('Trung') || i.region.includes('Hồng') || i.region.includes('Hàn') || i.region.includes('Singapore') || i.region.includes('Thái')) && !i.error);
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

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏦 <b>ETF NGÀNH → ẢNH HƯỞNG VN</b>\n\n`;

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

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🔮 <b>TÍN HIỆU NHANH CHO VN</b>\n\n`;

  const sp500 = indices.find(i => i.symbol === '.SPX');
  if (sp500 && !sp500.error) {
    if (sp500.changePct > 1) msg += `🟢 Mỹ tăng mạnh → VN có thể <b>GAP UP mở cửa</b>\n`;
    else if (sp500.changePct > 0) msg += `🟢 Mỹ tăng nhẹ → VN thiên hướng <b>TÍCH CỰC</b>\n`;
    else if (sp500.changePct < -1) msg += `🔴 Mỹ giảm mạnh → VN nguy cơ <b>GAP DOWN</b>\n`;
    else if (sp500.changePct < 0) msg += `🔴 Mỹ giảm nhẹ → VN áp lực <b>ĐIỀU CHỈNH</b>\n`;
    else msg += `🟡 Mỹ sideway → VN <b>PHÂN HÓA</b>\n`;
  }

  const topSector = sortedETFs[0];
  const botSector = sortedETFs[sortedETFs.length - 1];
  if (topSector && topSector.changePct > 0.5) {
    msg += `📈 Ngành nóng: <b>${topSector.vnSector}</b> (${topSector.symbol} +${topSector.changePct}%) → ${topSector.vnStocks}\n`;
  }
  if (botSector && botSector.changePct < -0.5) {
    msg += `📉 Ngành yếu: <b>${botSector.vnSector}</b> (${botSector.symbol} ${botSector.changePct}%) → ${botSector.vnStocks}\n`;
  }

  const vix = currencies.find(c => c.symbol === '.VIX');
  if (vix && !vix.error) {
    if (vix.price > 25) msg += `⚠️ VIX = ${vix.price} (CAO) → Thị trường lo ngại, <b>THẬN TRỌNG</b>\n`;
    else if (vix.price < 15) msg += `✅ VIX = ${vix.price} (THẤP) → Thị trường bình ổn\n`;
  }

  msg += `\n<i>⏳ AI đang phân tích chi tiết ảnh hưởng VN...</i>`;

  return msg;
}

function formatBigVol(vol) {
  if (!vol) return '0';
  if (vol >= 1000000000) return (vol / 1000000000).toFixed(2) + 'B';
  if (vol >= 1000000) return (vol / 1000000).toFixed(2) + 'M';
  if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
  return vol.toLocaleString();
}

async function fetchGlobalIndicesSimple() {
  console.log('\n🌍 Lấy dữ liệu TTCK quốc tế (đơn giản)...');
  const results = [];
  const symbols = GLOBAL_INDICES.map(i => i.symbol);

  try {
    const quotes = await withRetry(() => fetchCNBCQuotes(symbols), 3, 2000);
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    for (const idx of GLOBAL_INDICES) {
      const quote = quotesArray.find(q => q && q.symbol === idx.symbol);
      if (quote && quote.last !== undefined) {
        const changePct = parseFloat(quote.change_pct) || 0;
        results.push({
          ...idx,
          price: parseFloat(quote.last) || 0,
          change: parseFloat(quote.change) || 0,
          changePct: parseFloat(changePct.toFixed(2)),
          marketState: quote.market_state || 'REGULAR',
        });
        const sign = changePct >= 0 ? '+' : '';
        const icon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';
        console.log(`   ${icon} ${idx.name}: ${(parseFloat(quote.last) || 0).toLocaleString()} (${sign}${changePct.toFixed(2)}%)`);
      } else {
        results.push({ ...idx, price: 0, change: 0, changePct: 0, error: true });
        console.log(`   ⚠️  ${idx.name}: Không lấy được dữ liệu`);
      }
    }
  } catch (error) {
    console.error('   ❌ Lỗi lấy global indices simple:', error.message);
  }

  console.log(`   ✅ Lấy được ${results.filter(r => !r.error).length}/${GLOBAL_INDICES.length} chỉ số`);
  return results;
}

async function fetchGoldPrices() {
  console.log('\n🥇 Lấy giá vàng...');
  const result = { world: null, vietnam: null };

  try {
    const response = await axios.get('https://www.vang.today/api/prices', {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (response.data && response.data.success && response.data.prices) {
      const prices = response.data.prices;
      
      if (prices.XAUUSD) {
        result.world = {
          price: prices.XAUUSD.buy,
          change: prices.XAUUSD.change_buy,
          changePct: parseFloat(prices.XAUUSD.change_buy.toFixed(2)),
          currency: 'USD/oz',
        };
      }
      
      let sjc1Luong = null;
      let vangNhan1Chi = null;
      
      const sjcData = prices.SJL1L10 || prices.BTSJC || prices.VNGSJC || prices.VIETTINMSJC;
      if (sjcData) {
        sjc1Luong = {
          buy: sjcData.buy,
          sell: sjcData.sell,
          name: sjcData.name || 'SJC 1L',
        };
      }
      
      const nhanData = prices.SJ9999 || prices.BT9999NTT || prices.PQHN24NTT;
      if (nhanData) {
        vangNhan1Chi = {
          buy: Math.round(nhanData.buy / 10),
          sell: Math.round(nhanData.sell / 10),
          name: (nhanData.name || 'Nhẫn') + ' 1 chỉ',
        };
      }
      
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
        changePct: result.world ? result.world.changePct : 0,
        source: 'Vang.Today',
      };
      
      console.log('   ✅ Đã lấy thành công giá vàng từ Vang.Today');
      return result;
    }
  } catch (error) {
    console.warn('   ⚠️  Lỗi lấy giá vàng từ Vang.Today:', error.message);
  }

  try {
    const quotes = await fetchCNBCQuotes(['@GC.1']);
    const goldQuote = quotes.find(q => q && q.symbol === '@GC.1');
    if (goldQuote && goldQuote.last !== undefined) {
      const changePct = parseFloat(goldQuote.change_pct) || 0;
      result.world = {
        price: parseFloat(goldQuote.last) || 0,
        change: parseFloat(goldQuote.change) || 0,
        changePct: parseFloat(changePct.toFixed(2)),
        currency: 'USD/oz',
      };
      
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
        changePct,
        source: 'Quy đổi từ giá TG (CNBC)',
      };
      console.log('   ✅ Fallback lấy giá vàng TG từ CNBC thành công');
    }
  } catch (error) {
    console.error('   ⚠️  Lỗi fallback lấy giá vàng:', error.message);
  }

  return result;
}

function buildDailyGlobalSummaryMessage(indices, goldData, now) {
  let msg = `🌍 <b>BÁO CÁO TTCK QUỐC TẾ & GIÁ VÀNG</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const validIndices = indices.filter(i => !i.error);

  const regions = [
    { label: '🇺🇸 <b>Mỹ</b>', filter: i => i.region.includes('Mỹ') },
    { label: '🌏 <b>Châu Á</b>', filter: i => ['Nhật', 'Trung', 'Hồng', 'Hàn', 'Singapore', 'Thái'].some(k => i.region.includes(k)) },
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

  const usIndices = validIndices.filter(i => i.region.includes('Mỹ'));
  const asiaIndices = validIndices.filter(i => ['Nhật', 'Trung', 'Hồng', 'Hàn', 'Singapore', 'Thái'].some(k => i.region.includes(k)));

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

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🥇 <b>GIÁ VÀNG</b>\n\n`;

  if (goldData && goldData.world) {
    const g = goldData.world;
    const gIcon = g.changePct > 0 ? '🟢' : g.changePct < 0 ? '🔴' : '🟡';
    const gSign = g.changePct >= 0 ? '+' : '';
    msg += `🌐 <b>Vàng Thế Giới:</b>\n`;
    msg += `${gIcon} ${g.price.toLocaleString('en-US', {maximumFractionDigits: 2})}/oz (${gSign}${g.changePct}%)\n\n`;
  } else {
    msg += `🌐 Vàng TG: <i>Không lấy được dữ liệu</i>\n\n`;
  }

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
