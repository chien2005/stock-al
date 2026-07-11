/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧠 VN STOCK BOT - Smart Money Report v1.0                  ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Báo cáo Smart Money hàng ngày 20h30                         ║
 * ║  Phát hiện pattern từ dữ liệu lịch sử (không dùng AI)       ║
 * ║                                                               ║
 * ║  🏜️ Thanh khoản kiệt quệ / Cạn cung                         ║
 * ║  🔻 Phát hiện Đáy (Bottom Detection)                         ║
 * ║  🔄 Quay đầu thất bại (Failed Reversal)                      ║
 * ║  🧲 Tích lũy âm thầm (Silent Accumulation)                   ║
 * ║  🐋 Xả hàng có tổ chức (Institutional Distribution)          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { config } = require('./config');

const VPS_API = {
  realtime: 'https://bgapidatafeed.vps.com.vn/getliststockdata',
  history: 'https://histdatafeed.vps.com.vn/tradingview/history',
};
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// Mở rộng: VN30 + HOSE blue-chip + Midcap (dùng chung với stockService)
const SCAN_SYMBOLS = [
  'ACB', 'BCM', 'BVH', 'CTG', 'GAS', 'GVR', 'HDB', 'KDH',
  'PLX', 'POW', 'SAB', 'SHB', 'SSB', 'STB', 'TCB', 'TPB',
  'VHM', 'VIB', 'VJC', 'VPB', 'VRE',
  'DGC', 'PNJ', 'REE', 'VND', 'HCM', 'DPM', 'DCM', 'GEX',
  'NLG', 'PHR', 'HAG', 'PDR', 'EIB', 'LPB', 'OCB', 'MSB',
  'DHG', 'FRT', 'VCI', 'GMD', 'VTP', 'PC1', 'NT2', 'BWE',
  'DBC', 'HSG', 'NKG', 'TLG', 'DXG', 'KBC', 'IJC', 'HDC',
  'SHS', 'VDS', 'CTS', 'AGG', 'DIG', 'HDG', 'KOS', 'ANV',
  'VHC', 'IDC', 'PVT', 'PVD', 'TCH', 'HBC', 'LDG', 'CEO',
  'TIG', 'FCN', 'SCR', 'DXS', 'NVL', 'AAA', 'GIL', 'PTB',
  'FLC', 'ROS', 'HQC', 'OGC', 'KSB', 'CII', 'SBT', 'ASM',
  'QBS', 'HVN', 'TSC', 'PAN', 'VOS', 'HHS', 'VGC', 'CRE',
];

// ─── MAIN: Run Smart Money Report ──────────────────────────

/**
 * Chạy Smart Money Report — quét toàn bộ mã, phát hiện pattern
 * @returns {Object} { patterns, message } - patterns cho AI, message cho Telegram
 */
async function runSmartMoneyReport() {
  console.log('\n🧠 SMART MONEY REPORT — Đang quét thị trường...');

  // Gộp watchlist + scan symbols (loại trùng)
  const allSymbols = [...new Set([...config.stockSymbols, ...SCAN_SYMBOLS])];
  console.log(`   📡 Quét ${allSymbols.length} mã...`);

  // Fetch history 10 phiên cho tất cả mã (song song, batch 20)
  const historyData = {};
  const realtimeData = {};

  // 1. Fetch realtime data (1 batch)
  try {
    const res = await axios.get(`${VPS_API.realtime}/${allSymbols.join(',')}`, {
      headers: HEADERS, timeout: 15000,
    });
    for (const raw of (res.data || [])) {
      if (raw.sym) {
        realtimeData[raw.sym] = {
          price: parseFloat(raw.lastPrice || 0) * 1000,
          refPrice: parseFloat(raw.r || 0) * 1000,
          volume: parseInt(raw.lot || 0),
          foreignBuy: parseInt(raw.fBVol || 0),
          foreignSell: parseInt(raw.fSVolume || 0),
          foreignNet: parseInt(raw.fBVol || 0) - parseInt(raw.fSVolume || 0),
          changePct: 0, // will calc below
        };
        const rt = realtimeData[raw.sym];
        rt.changePct = rt.refPrice > 0
          ? parseFloat(((rt.price - rt.refPrice) / rt.refPrice * 100).toFixed(2))
          : 0;
      }
    }
    console.log(`   ✅ Realtime: ${Object.keys(realtimeData).length} mã`);
  } catch (e) {
    console.error(`   ❌ Lỗi fetch realtime:`, e.message);
    return { patterns: {}, message: null };
  }

  // 2. Fetch history data (batch 15 mỗi lần, chờ giữa các batch)
  const now = Math.floor(Date.now() / 1000);
  const from = now - 86400 * 30; // 30 ngày

  const batchSize = 15;
  for (let i = 0; i < allSymbols.length; i += batchSize) {
    const batch = allSymbols.slice(i, i + batchSize);
    const promises = batch.map(async (symbol) => {
      try {
        const url = `${VPS_API.history}?symbol=${symbol}&resolution=D&from=${from}&to=${now}`;
        const res = await axios.get(url, { headers: HEADERS, timeout: 8000 });
        if (res.data && res.data.c && res.data.c.length >= 5) {
          historyData[symbol] = res.data;
        }
      } catch (e) { /* silent */ }
    });
    await Promise.all(promises);
    // Delay nhẹ giữa các batch
    if (i + batchSize < allSymbols.length) {
      await sleep(300);
    }
  }
  console.log(`   ✅ History: ${Object.keys(historyData).length} mã`);

  // 3. Phát hiện patterns
  const patterns = {
    exhaustedLiquidity: [],  // 🏜️ Thanh khoản kiệt quệ
    bottomDetection: [],     // 🔻 Phát hiện đáy
    failedReversal: [],      // 🔄 Quay đầu thất bại
    silentAccumulation: [],  // 🧲 Tích lũy âm thầm
    institutionalDist: [],   // 🐋 Xả hàng có tổ chức
  };

  for (const symbol of allSymbols) {
    const history = historyData[symbol];
    const rt = realtimeData[symbol];
    if (!history || !rt) continue;

    const closes = history.c;
    const volumes = history.v || [];
    const highs = history.h || [];
    const lows = history.l || [];

    if (closes.length < 5 || volumes.length < 5) continue;

    // Tính các giá trị cần thiết
    const avgVol20 = volumes.length >= 20
      ? volumes.slice(-20).reduce((s, v) => s + v, 0) / 20
      : volumes.reduce((s, v) => s + v, 0) / volumes.length;

    const lastClose = closes[closes.length - 1] * 1000; // VND
    const prevClose = closes[closes.length - 2] * 1000;

    // ─── PATTERN 1: Thanh khoản kiệt quệ ────────────────
    // KL giao dịch < 30% KLTB20 liên tục 3+ phiên gần nhất
    if (volumes.length >= 5 && avgVol20 > 0) {
      const last3Vols = volumes.slice(-3);
      const allExhausted = last3Vols.every(v => v < avgVol20 * 0.3);
      if (allExhausted) {
        const avgRatio = (last3Vols.reduce((s, v) => s + v, 0) / 3 / avgVol20 * 100).toFixed(0);
        patterns.exhaustedLiquidity.push({
          symbol,
          price: rt.price,
          changePct: rt.changePct,
          avgVolRatio: parseFloat(avgRatio),
          avgVol20: Math.round(avgVol20),
          last3AvgVol: Math.round(last3Vols.reduce((s, v) => s + v, 0) / 3),
          description: `KL 3 phiên gần nhất chỉ ${avgRatio}% KLTB20 — cung cạn kiệt`,
        });
      }
    }

    // ─── PATTERN 2: Phát hiện Đáy (Bottom Detection) ─────
    // Giảm sâu > 15% trong 10 phiên, nhưng hôm nay KL tăng + giá hồi
    if (closes.length >= 10) {
      const close10Ago = closes[closes.length - 10] * 1000;
      const dropPct = close10Ago > 0 ? ((lastClose - close10Ago) / close10Ago * 100) : 0;

      // RSI đơn giản (14 phiên nếu đủ, nếu không dùng ít hơn)
      const rsi = calcSimpleRSI(closes, Math.min(14, closes.length - 1));

      if (dropPct <= -15 && rsi !== null && rsi < 35) {
        // Hôm nay giá hồi (> hôm qua) VÀ KL khá (> 60% KLTB20)
        const todayVol = rt.volume;
        const priceRecovery = rt.price > prevClose;
        const volOk = todayVol > avgVol20 * 0.6;

        if (priceRecovery && volOk) {
          patterns.bottomDetection.push({
            symbol,
            price: rt.price,
            changePct: rt.changePct,
            dropPct: parseFloat(dropPct.toFixed(1)),
            rsi: parseFloat(rsi.toFixed(1)),
            volume: todayVol,
            avgVol20: Math.round(avgVol20),
            description: `Giảm ${dropPct.toFixed(1)}% trong 10 phiên, RSI=${rsi.toFixed(0)}, hôm nay hồi +${rt.changePct}%`,
          });
        }
      }
    }

    // ─── PATTERN 3: Quay đầu thất bại (Failed Reversal) ──
    // CP đang trong nhịp tăng (ROC5 > 3%) nhưng hôm nay giảm mạnh (< -2%)
    if (closes.length >= 6) {
      const close5Ago = closes[closes.length - 6] * 1000; // 5 phiên trước hôm nay
      const roc5 = close5Ago > 0 ? ((prevClose - close5Ago) / close5Ago * 100) : 0;

      if (roc5 > 3 && rt.changePct < -2) {
        patterns.failedReversal.push({
          symbol,
          price: rt.price,
          changePct: rt.changePct,
          roc5: parseFloat(roc5.toFixed(1)),
          description: `Đang tăng ${roc5.toFixed(1)}% trong 5 phiên, hôm nay đột ngột giảm ${rt.changePct}%`,
        });
      }
    }

    // ─── PATTERN 4: Tích lũy âm thầm (Silent Accumulation) ──
    // NN mua ròng 4/5 phiên gần nhất VÀ tổng NN ròng > 5% KLTB20 VÀ giá chưa tăng nhiều
    if (history.t && history.t.length >= 5) {
      // Cần dùng realtime NN ròng cho hôm nay + ước tính từ history cho các ngày trước
      // VPS history API không có foreignNet → dùng heuristic: volume spike + price flat
      // Thay vào đó, kiểm tra pattern từ volume + price
      const last5Closes = closes.slice(-5).map(c => c * 1000);
      const last5Vols = volumes.slice(-5);
      const priceChange5d = last5Closes.length >= 2
        ? ((last5Closes[last5Closes.length - 1] - last5Closes[0]) / last5Closes[0] * 100)
        : 0;

      // Nếu hôm nay NN mua ròng mạnh VÀ giá 5 ngày chỉ dao động nhẹ
      if (rt.foreignNet > 0 && Math.abs(priceChange5d) < 3) {
        const nnNetPctOfAvg = avgVol20 > 0 ? (rt.foreignNet / avgVol20 * 100) : 0;
        // NN ròng hôm nay > 5% KLTB20 VÀ KL giao dịch bình thường (không spike quá)
        if (nnNetPctOfAvg > 5 && rt.volume < avgVol20 * 2) {
          patterns.silentAccumulation.push({
            symbol,
            price: rt.price,
            changePct: rt.changePct,
            foreignNet: rt.foreignNet,
            nnPctOfAvg: parseFloat(nnNetPctOfAvg.toFixed(1)),
            priceChange5d: parseFloat(priceChange5d.toFixed(1)),
            description: `NN mua ròng ${fmtVol(rt.foreignNet)} (${nnNetPctOfAvg.toFixed(0)}% KLTB20), giá 5 ngày chỉ ${priceChange5d > 0 ? '+' : ''}${priceChange5d.toFixed(1)}%`,
          });
        }
      }
    }

    // ─── PATTERN 5: Xả hàng có tổ chức (Institutional Distribution) ──
    // NN bán ròng hôm nay VÀ giá giảm mạnh VÀ KL tăng
    if (rt.foreignNet < 0 && rt.changePct < -2) {
      const nnSellPctOfAvg = avgVol20 > 0 ? (Math.abs(rt.foreignNet) / avgVol20 * 100) : 0;
      const volRatio = avgVol20 > 0 ? (rt.volume / avgVol20) : 1;

      // Bán ròng > 3% KLTB20 VÀ KL tăng (> 120% TB)
      if (nnSellPctOfAvg > 3 && volRatio > 1.2) {
        // Kiểm tra giá đã giảm liên tục chưa (3 phiên gần nhất)
        const last3Closes = closes.slice(-3).map(c => c * 1000);
        const priceDownStreak = last3Closes.length >= 3
          && last3Closes[2] < last3Closes[1] && last3Closes[1] < last3Closes[0];

        if (priceDownStreak || rt.changePct < -4) {
          patterns.institutionalDist.push({
            symbol,
            price: rt.price,
            changePct: rt.changePct,
            foreignNet: rt.foreignNet,
            nnPctOfAvg: parseFloat(nnSellPctOfAvg.toFixed(1)),
            volRatio: parseFloat(volRatio.toFixed(1)),
            description: `NN bán ròng ${fmtVol(rt.foreignNet)} (${nnSellPctOfAvg.toFixed(0)}% KLTB20), giá giảm ${rt.changePct}%, KL ${volRatio.toFixed(1)}x TB`,
          });
        }
      }
    }
  }

  // Sắp xếp kết quả
  patterns.exhaustedLiquidity.sort((a, b) => a.avgVolRatio - b.avgVolRatio);
  patterns.bottomDetection.sort((a, b) => a.rsi - b.rsi);
  patterns.failedReversal.sort((a, b) => a.changePct - b.changePct);
  patterns.silentAccumulation.sort((a, b) => b.nnPctOfAvg - a.nnPctOfAvg);
  patterns.institutionalDist.sort((a, b) => a.changePct - b.changePct);

  // Log summary
  const totalPatterns = Object.values(patterns).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`   🧠 Phát hiện ${totalPatterns} pattern:`);
  console.log(`      🏜️ Cạn cung: ${patterns.exhaustedLiquidity.length}`);
  console.log(`      🔻 Đáy tiềm năng: ${patterns.bottomDetection.length}`);
  console.log(`      🔄 Quay đầu thất bại: ${patterns.failedReversal.length}`);
  console.log(`      🧲 Tích lũy âm thầm: ${patterns.silentAccumulation.length}`);
  console.log(`      🐋 Xả hàng tổ chức: ${patterns.institutionalDist.length}`);

  // Build Telegram message
  const message = buildSmartMoneyMessage(patterns);

  return { patterns, message };
}

// ─── BUILD TELEGRAM MESSAGE ─────────────────────────────────

function buildSmartMoneyMessage(patterns) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: config.timezone });
  const totalPatterns = Object.values(patterns).reduce((sum, arr) => sum + arr.length, 0);

  if (totalPatterns === 0) {
    return null; // Không có pattern → không gửi
  }

  let msg = `🧠 <b>SMART MONEY REPORT</b>\n`;
  msg += `🕐 <i>${now}</i>\n`;
  msg += `📊 <i>Quét ${[...new Set([...config.stockSymbols, ...SCAN_SYMBOLS])].length} mã — Phát hiện ${totalPatterns} tín hiệu</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 🏜️ Thanh khoản kiệt quệ
  if (patterns.exhaustedLiquidity.length > 0) {
    msg += `🏜️ <b>THANH KHOẢN KIỆT QUỆ — CẠN CUNG</b>\n`;
    msg += `<i>KL giao dịch < 30% KLTB20 suốt 3 phiên → cung cạn, có thể sắp bùng nổ</i>\n\n`;
    for (const p of patterns.exhaustedLiquidity.slice(0, 5)) {
      const sign = p.changePct >= 0 ? '+' : '';
      msg += `   📌 <b>${p.symbol}</b> ${fmtPrice(p.price)} (${sign}${p.changePct}%)\n`;
      msg += `      KL 3 phiên: chỉ <b>${p.avgVolRatio}%</b> KLTB20 (${fmtVol(p.avgVol20)})\n`;
      msg += `      <i>→ Cung cạn kiệt, theo dõi breakout</i>\n\n`;
    }
  }

  // 🔻 Phát hiện Đáy
  if (patterns.bottomDetection.length > 0) {
    msg += `🔻 <b>PHÁT HIỆN ĐÁY TIỀM NĂNG</b>\n`;
    msg += `<i>Giảm sâu > 15%, RSI quá bán, hôm nay có dấu hiệu hồi phục</i>\n\n`;
    for (const p of patterns.bottomDetection.slice(0, 5)) {
      const sign = p.changePct >= 0 ? '+' : '';
      msg += `   📌 <b>${p.symbol}</b> ${fmtPrice(p.price)} (${sign}${p.changePct}%)\n`;
      msg += `      📉 Đã giảm <b>${p.dropPct}%</b> trong 10 phiên | RSI = <b>${p.rsi}</b>\n`;
      msg += `      📦 KL hôm nay: ${fmtVol(p.volume)} (TB: ${fmtVol(p.avgVol20)})\n`;
      msg += `      <i>→ Có thể là đáy, xem xét bắt đáy thận trọng</i>\n\n`;
    }
  }

  // 🔄 Quay đầu thất bại
  if (patterns.failedReversal.length > 0) {
    msg += `🔄 <b>QUAY ĐẦU THẤT BẠI — KÉO GIÁ KHÔNG THÀNH</b>\n`;
    msg += `<i>CP đang trong nhịp tăng T+ bỗng quay đầu giảm mạnh</i>\n\n`;
    for (const p of patterns.failedReversal.slice(0, 5)) {
      msg += `   📌 <b>${p.symbol}</b> ${fmtPrice(p.price)} (<b>${p.changePct}%</b>)\n`;
      msg += `      📈 5 phiên trước tăng <b>+${p.roc5}%</b> → hôm nay đảo chiều <b>${p.changePct}%</b>\n`;
      msg += `      <i>→ ⚠️ Kéo giá thất bại, cảnh báo T+ trap</i>\n\n`;
    }
  }

  // 🧲 Tích lũy âm thầm
  if (patterns.silentAccumulation.length > 0) {
    msg += `🧲 <b>TÍCH LŨY ÂM THẦM — TAY TO GOM HÀNG</b>\n`;
    msg += `<i>NN mua ròng mạnh nhưng giá chưa phản ánh → sắp đẩy giá?</i>\n\n`;
    for (const p of patterns.silentAccumulation.slice(0, 5)) {
      const sign = p.changePct >= 0 ? '+' : '';
      msg += `   📌 <b>${p.symbol}</b> ${fmtPrice(p.price)} (${sign}${p.changePct}%)\n`;
      msg += `      💚 NN mua ròng: <b>+${fmtVol(p.foreignNet)}</b> (${p.nnPctOfAvg}% KLTB20)\n`;
      msg += `      📊 Giá 5 ngày: ${p.priceChange5d > 0 ? '+' : ''}${p.priceChange5d}% → <b>chưa phản ánh</b>\n`;
      msg += `      <i>→ Dấu hiệu gom hàng trước khi đẩy giá</i>\n\n`;
    }
  }

  // 🐋 Xả hàng có tổ chức
  if (patterns.institutionalDist.length > 0) {
    msg += `🐋 <b>XẢ HÀNG CÓ TỔ CHỨC — DÒNG TIỀN THÁO CHẠY</b>\n`;
    msg += `<i>NN bán ròng mạnh + giá giảm liên tục + KL tăng</i>\n\n`;
    for (const p of patterns.institutionalDist.slice(0, 5)) {
      msg += `   📌 <b>${p.symbol}</b> ${fmtPrice(p.price)} (<b>${p.changePct}%</b>)\n`;
      msg += `      💔 NN bán ròng: <b>${fmtVol(p.foreignNet)}</b> (${p.nnPctOfAvg}% KLTB20)\n`;
      msg += `      📦 KL: <b>${p.volRatio}x</b> trung bình\n`;
      msg += `      <i>→ ⚠️ Tránh mua, dòng tiền đang rút</i>\n\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🧠 Smart Money Report v1.0 | Rule-based (không AI)</i>\n`;
  msg += `<i>⚠️ Tham khảo, không phải lời khuyên đầu tư.</i>\n`;
  msg += `<i>🤖 VN Stock Bot v${config.version}</i>`;

  return msg;
}

// ─── FORMAT FOR AI PROMPT ───────────────────────────────────

/**
 * Format patterns thành text ngắn gọn cho AI prompt
 */
function formatPatternsForAI(patterns) {
  if (!patterns) return '';

  const sections = [];

  if (patterns.exhaustedLiquidity.length > 0) {
    sections.push('CẠN CUNG (KL < 30% TB 3 phiên liên tiếp): ' +
      patterns.exhaustedLiquidity.slice(0, 5).map(p =>
        `${p.symbol}(KL=${p.avgVolRatio}%TB, giá ${p.changePct >= 0 ? '+' : ''}${p.changePct}%)`
      ).join(', '));
  }

  if (patterns.bottomDetection.length > 0) {
    sections.push('ĐÁY TIỀM NĂNG (giảm >15% + RSI<35 + hồi phục): ' +
      patterns.bottomDetection.slice(0, 5).map(p =>
        `${p.symbol}(giảm ${p.dropPct}%, RSI=${p.rsi}, hôm nay ${p.changePct >= 0 ? '+' : ''}${p.changePct}%)`
      ).join(', '));
  }

  if (patterns.failedReversal.length > 0) {
    sections.push('QUAY ĐẦU THẤT BẠI (T+ tăng rồi đảo chiều): ' +
      patterns.failedReversal.slice(0, 5).map(p =>
        `${p.symbol}(5ph tăng +${p.roc5}% → hôm nay ${p.changePct}%)`
      ).join(', '));
  }

  if (patterns.silentAccumulation.length > 0) {
    sections.push('TÍCH LŨY ÂM THẦM (NN gom + giá chưa tăng): ' +
      patterns.silentAccumulation.slice(0, 5).map(p =>
        `${p.symbol}(NN+${fmtVol(p.foreignNet)}=${p.nnPctOfAvg}%TB, 5d ${p.priceChange5d > 0 ? '+' : ''}${p.priceChange5d}%)`
      ).join(', '));
  }

  if (patterns.institutionalDist.length > 0) {
    sections.push('XẢ HÀNG TỔ CHỨC (NN bán + giá giảm + KL tăng): ' +
      patterns.institutionalDist.slice(0, 5).map(p =>
        `${p.symbol}(NN${fmtVol(p.foreignNet)}, ${p.changePct}%, KL ${p.volRatio}xTB)`
      ).join(', '));
  }

  if (sections.length === 0) return '';

  return '\n\nSMART MONEY PATTERNS (phát hiện tự động từ data lịch sử):\n' + sections.join('\n');
}

// ─── HELPERS ────────────────────────────────────────────────

/**
 * RSI đơn giản
 */
function calcSimpleRSI(closes, period) {
  if (!closes || closes.length < period + 1) return null;
  const recent = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function fmtVol(v) {
  if (!v) return '0';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
  return s + v.toLocaleString('vi-VN');
}

function fmtPrice(p) {
  return p ? p.toLocaleString('vi-VN') + 'đ' : '---';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { runSmartMoneyReport, formatPatternsForAI };
