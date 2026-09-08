/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔮 VN30F SIGNAL ENGINE v4.0 — Main Orchestrator           ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  8-Layer Analysis Pipeline                                    ║
 * ║  1. Market Structure  → Price Map, S/R, Volume Profile       ║
 * ║  2. Test/Retest       → Rejection, Acceptance/Excursion      ║
 * ║  3. Flow Engine       → Delta/CVD, Absorption, Sweep         ║
 * ║  4. Cross-Market      → Basis Dynamics, OI State, Lead-Lag   ║
 * ║  5. Breadth & Leaders → Acceleration, Concentration          ║
 * ║  6. Regime Engine     → 8 Regimes + Expiry Mode              ║
 * ║  7. Scoring Engine    → 100-pt Weighted + Gating             ║
 * ║  8. Target Engine     → Structural Targets + Invalidation    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config, isCurrentInstanceActive } = require('../config');
const { sendDerivativesMessage } = require('../telegramService');

// ─── 8 ENGINES ───────────────────────────────────────────────
const dataFetcher = require('./dataFetcher');
const { buildPriceMap, findNearestLevels } = require('./marketStructure');
const { analyzeTests, analyzeAcceptance } = require('./testRetest');
const { analyzeFlow, detectAbsorption, detectLiquiditySweep, calculateVelocity, calculateEfficiency } = require('./flowEngine');
const { analyzeBasis, classifyOIState, analyzeLeadLag } = require('./crossMarket');
const { analyzeBreadth, analyzeLeaders, analyzeLiquidity } = require('./breadthEngine');
const { classifyRegime } = require('./regimeEngine');
const { calculateScore } = require('./scoringEngine');
const { buildTargetMap } = require('./targetEngine');
const { buildSignalNotification, buildLeaderAlert, buildTrapAlert } = require('./notificationBuilder');
const { saveSignalSnapshot } = require('./snapshotStore');
const oiTracker = require('./oiTracker');

// ─── STATE ───────────────────────────────────────────────────────
const _state = {
  morningSignal: null,
  afternoonSignal: null,
  prevBasis: null,
  prevLeaderSnapshot: null,
  lastMomentumPrice: null,
  lastMomentumTime: 0,
  lastAlertTime: {},         // { alertType: timestamp }
  momentumTimer: null,
  // ─── PREV NOTI SNAPSHOT (cho delta giữa 2 noti) ───
  prevNotiTimestamp: null,
  prevLiquiditySnapshot: null,   // { vn30Value, vnindexValue, vn30Price, vnindexPrice }
  prevOISnapshot: null,          // { totalOI, totalVolume, f1mPrice }
  prevVN30BuySellSnapshot: null, // { [sym]: { totalVal, fnNet } }
  // ─── v4.2: Anti-Whipsaw state ───
  lastSignalDirection: null,     // 'LONG' | 'SHORT' | null
  lastSignalTime: null,          // timestamp (ms)
  // ─── v4.3: Price-Change Monitor state ───
  priceChangeTimer: null,
  lastNotiPrice: null,           // Giá lúc bắn noti gần nhất
  lastNotiTime: 0,               // Timestamp lúc bắn noti gần nhất
  initialNotiSent: false,        // Đã bắn noti đầu tiên chưa (9h05)
};

// ─── CORE: Run full 8-layer analysis pipeline ────────────────
async function runFullAnalysis() {
  console.log('   🔮 [v4.2] Chạy pipeline phân tích 8 lớp (Thiên Hạ Ngũ Tuyệt)...');

  // ─── FETCH ALL DATA ────────────────────────────────
  const allData = await dataFetcher.fetchAllData();

  // ─── LỚP 1: MARKET STRUCTURE ──────────────────────
  console.log('   📍 [1/8] Market Structure...');
  const priceMap = buildPriceMap({
    intradayF1M: allData.intraday1m,
    dailyF1M: allData.daily.f1m,
    dailyVN30: allData.daily.vn30,
  });

  // ─── LỚP 2: TEST/RETEST + ACCEPTANCE ──────────────
  console.log('   🔄 [2/8] Test/Retest + Acceptance...');
  const testResults = analyzeTests(allData.intraday1m, priceMap.levels);
  const acceptanceResult = analyzeAcceptance(allData.intraday1m, priceMap);

  // ─── LỚP 3: FLOW ENGINE ──────────────────────────
  console.log('   📊 [3/8] Flow Engine...');
  const flowResult = analyzeFlow(allData.intraday1m);
  const absorptionResult = detectAbsorption(allData.intraday1m);
  const sweepResult = detectLiquiditySweep(allData.intraday1m, priceMap.levels);
  const velocityResult = calculateVelocity(allData.intraday1m);
  const efficiencyResult = calculateEfficiency(allData.intraday1m, 20);

  // ─── LỚP 4: CROSS-MARKET ─────────────────────────
  console.log('   📐 [4/8] Cross-Market...');
  const f1mPrice = allData.futuresPrice ? allData.futuresPrice.price : null;
  const vn30Price = allData.vn30Price ? allData.vn30Price.price : null;
  const basisResult = analyzeBasis(f1mPrice, vn30Price, allData.daily.f1m, allData.daily.vn30, _state.prevBasis);
  const oiState = classifyOIState(allData.oiData, f1mPrice, allData.daily.f1m);
  const leadLag = analyzeLeadLag(allData.vn30Intraday, allData.intraday1m);

  // Update state
  _state.prevBasis = basisResult.current;

  // ─── LỚP 5: BREADTH & LEADERS ────────────────────
  console.log('   🏛️ [5/8] Breadth & Leaders...');
  const breadthResult = analyzeBreadth(allData.realtimeVN30);
  const leaderResult = analyzeLeaders(breadthResult, _state.prevLeaderSnapshot);
  const liquidityResult = analyzeLiquidity(allData.realtimeVN30, allData.daily.vnindex);

  // Update leader snapshot
  _state.prevLeaderSnapshot = leaderResult.snapshot;

  // ─── LỚP 6: REGIME ENGINE ────────────────────────
  console.log('   🌡️ [6/8] Regime Engine...');
  const regimeResult = classifyRegime({
    priceMap,
    flowResult,
    breadthResult,
    efficiencyResult,
    velocityResult,
    liquidityResult,
  });

  // ─── LỚP 7: SCORING ENGINE ───────────────────────
  console.log('   ⚖️ [7/8] Scoring Engine...');
  const scoreResult = calculateScore({
    priceMap,
    testResults,
    acceptanceResult,
    flowResult,
    absorptionResult,
    sweepResult,
    velocityResult,
    efficiencyResult,
    basisResult,
    oiState,
    leadLag,
    breadthResult,
    leaderResult,
    liquidityResult,
    regimeResult,
    // ─── v4.2 NEW PARAMS ───
    lastSignalDirection: _state.lastSignalDirection,
    lastSignalTime: _state.lastSignalTime,
    dailyVN30: allData.daily.vn30,
  });

  // v4.2: Track signal direction for anti-whipsaw
  if (scoreResult.direction === 'LONG' || scoreResult.direction === 'SHORT') {
    _state.lastSignalDirection = scoreResult.direction;
    _state.lastSignalTime = Date.now();
  }

  // ─── LỚP 8: TARGET ENGINE ────────────────────────
  console.log('   🎯 [8/8] Target Engine...');
  const targetMap = buildTargetMap({
    direction: scoreResult.direction,
    priceMap,
    basisResult,
    absorptionResult,
    dailyF1M: allData.daily.f1m,
  });

  // v4.2: Log veto info
  if (scoreResult.vetoed && scoreResult.vetoType) {
    console.log(`   🛡️ VETO [${scoreResult.vetoType}]: ${scoreResult.vetoReason}`);
  }

  console.log(`   ✅ Pipeline v4.2 hoàn thành: ${scoreResult.direction} (${scoreResult.confidence}/100, ${scoreResult.setupQuality})`);

  return {
    scoreResult,
    priceMap,
    testResults,
    acceptanceResult,
    flowResult,
    absorptionResult,
    sweepResult,
    velocityResult,
    efficiencyResult,
    basisResult,
    oiState,
    leadLag,
    breadthResult,
    leaderResult,
    liquidityResult,
    regimeResult,
    targetMap,
    allData,
  };
}

// ─── HELPER: Build VN30 buy/sell snapshot ─────────────────
function _buildVN30BuySellSnapshot(realtimeVN30) {
  const snapshot = {};
  if (!realtimeVN30 || !realtimeVN30.raw) return snapshot;
  for (const r of realtimeVN30.raw) {
    if (!r.sym) continue;
    const price = parseFloat(r.lastPrice || 0) * 1000;
    const vol = parseInt(r.lot || 0) * 10;
    const fBuy = parseInt(r.fBVol || 0) * 10;
    const fSell = parseInt(r.fSVolume || 0) * 10;
    const refPrice = parseFloat(r.r || 0) * 1000;
    const changePct = refPrice > 0 ? ((price - refPrice) / refPrice) * 100 : 0;
    if (price > 0) {
      snapshot[r.sym] = {
        totalVal: parseFloat(((vol * price) / 1e9).toFixed(2)),
        fnNet: parseFloat((((fBuy - fSell) * price) / 1e9).toFixed(2)),
        price,
        changePct: parseFloat(changePct.toFixed(2)),
      };
    }
  }
  return snapshot;
}

// ─── HELPER: Compute deltas between 2 VN30 buy/sell snapshots ───
function _computeVN30Deltas(current, prev) {
  if (!prev || !current) return { buyers: [], sellers: [] };
  const deltas = [];
  for (const sym of Object.keys(current)) {
    const cur = current[sym];
    const prv = prev[sym];
    if (!prv) continue;
    const deltaVal = parseFloat((cur.totalVal - prv.totalVal).toFixed(2));
    deltas.push({ sym, deltaVal, changePct: cur.changePct });
  }
  deltas.sort((a, b) => b.deltaVal - a.deltaVal);
  const buyers = deltas.filter(d => d.deltaVal > 0).slice(0, 5);
  const sellers = deltas.filter(d => d.deltaVal < 0).sort((a, b) => a.deltaVal - b.deltaVal).slice(0, 5);
  return { buyers, sellers };
}

// ─── UNIFIED DERIVATIVES SIGNAL JOB (9h05 → 14h30 mỗi 5p) ────
async function runDerivativesSignalJob() {
  if (!isCurrentInstanceActive()) return;

  console.log('\n' + '='.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL v4.2 — UPDATE');
  console.log('='.repeat(55));

  try {
    const analysis = await runFullAnalysis();
    const { allData, liquidityResult, oiState, basisResult } = analysis;

    // ─── Build current snapshots ───
    const currentLiquidity = {
      vn30Value: liquidityResult.totalValue,
      vnindexPrice: allData.vnindexPrice ? allData.vnindexPrice.price : null,
      vn30Price: allData.vn30Price ? allData.vn30Price.price : null,
    };

    const currentOI = {
      totalOI: oiState.totalOI || null,
      totalVolume: allData.oiData.totalVolume || null,
      f1mPrice: basisResult.f1mPrice,
    };

    const currentVN30BuySell = _buildVN30BuySellSnapshot(allData.realtimeVN30);

    // ─── Compute deltas vs prev noti ───
    let deltaData = null;
    if (_state.prevNotiTimestamp) {
      const timeDiffMs = Date.now() - _state.prevNotiTimestamp;
      const timeDiffMin = Math.round(timeDiffMs / 60000);

      // Liquidity delta
      let liqDelta = null;
      if (_state.prevLiquiditySnapshot) {
        liqDelta = {
          vn30Delta: _state.prevLiquiditySnapshot.vn30Value != null
            ? parseFloat((currentLiquidity.vn30Value - _state.prevLiquiditySnapshot.vn30Value).toFixed(1))
            : null,
          prevVN30Value: _state.prevLiquiditySnapshot.vn30Value,
        };
      }

      // OI delta (long/short contracts)
      let oiDelta = null;
      if (_state.prevOISnapshot && _state.prevOISnapshot.totalOI != null && currentOI.totalOI != null) {
        const deltaOI = currentOI.totalOI - _state.prevOISnapshot.totalOI;
        const deltaVol = (currentOI.totalVolume || 0) - (_state.prevOISnapshot.totalVolume || 0);
        const priceDelta = currentOI.f1mPrice - (_state.prevOISnapshot.f1mPrice || currentOI.f1mPrice);

        // Classify position state
        let positionState = 'NEUTRAL';
        if (deltaOI > 0 && priceDelta > 0) positionState = 'LONG_BUILDUP';
        else if (deltaOI > 0 && priceDelta < 0) positionState = 'SHORT_BUILDUP';
        else if (deltaOI < 0 && priceDelta < 0) positionState = 'LONG_LIQUIDATION';
        else if (deltaOI < 0 && priceDelta > 0) positionState = 'SHORT_COVERING';

        oiDelta = {
          deltaOI,
          deltaVol: deltaVol > 0 ? deltaVol : 0,
          totalOI: currentOI.totalOI,
          positionState,
          priceDelta: parseFloat(priceDelta.toFixed(1)),
        };
      }

      // VN30 buy/sell delta
      const vn30Deltas = _computeVN30Deltas(currentVN30BuySell, _state.prevVN30BuySellSnapshot);

      deltaData = {
        timeDiffMin,
        liqDelta,
        oiDelta,
        vn30Deltas,
      };
    }

    // ─── Build & send notification ───
    const msg = buildSignalNotification('update', analysis, deltaData);
    await sendDerivativesMessage(msg);

    // Save snapshot cho backtest
    _saveSnapshot(analysis);

    // Start momentum monitor (nếu chưa chạy)
    if (!_state.momentumTimer) {
      startMomentumMonitor();
    }

    // ─── Update prev snapshots ───
    _state.prevNotiTimestamp = Date.now();
    _state.prevLiquiditySnapshot = currentLiquidity;
    _state.prevOISnapshot = currentOI;
    _state.prevVN30BuySellSnapshot = currentVN30BuySell;
    _state.lastNotiPrice = basisResult.f1mPrice || _state.lastNotiPrice;
    _state.lastNotiTime = Date.now();
    _state.initialNotiSent = true;

  } catch (e) {
    console.error('   ❌ Derivatives signal job error v4.2:', e.message);
  }
}

// ─── LEGACY JOB ALIASES (backward compat) ────────────────────
const runMorningDerivativesJob = runDerivativesSignalJob;
const runMidMorningDerivativesJob = runDerivativesSignalJob;
const runAfternoonDerivativesJob = runDerivativesSignalJob;

// ─── AI DERIVATIVES JOB ─────────────────────────────────────
async function runAIDerivativesJob(session) {
  if (!isCurrentInstanceActive()) return;

  const sessionLabels = {
    'morning': 'SÁNG (9h22)',
    'midmorning': 'GIỮA SÁNG (10h22)',
    'afternoon': 'CHIỀU (13h50)',
  };
  const sessionLabel = sessionLabels[session] || session;

  console.log('\n' + '═'.repeat(55));
  console.log(`🤖 AI DERIVATIVES ANALYSIS v4.0 — ${sessionLabel}`);
  console.log('═'.repeat(55));

  try {
    const analysis = await runFullAnalysis();
    const { scoreResult, basisResult, breadthResult, liquidityResult, regimeResult, flowResult, targetMap } = analysis;

    const apiKey = config.geminiAI4.apiKey || config.geminiAI1.apiKey;
    if (!apiKey) {
      console.log('   ⚠️ Không có API key cho AI');
      return;
    }

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const prompt = `Bạn là Giám Đốc Quỹ Đầu Tư chuyên VN30F hàng đầu Việt Nam.

DỮ LIỆU THỰC TẾ VN30F v4.0 (${dataFetcher.vnNow()}):

HƯỚNG: ${scoreResult.direction} (${scoreResult.confidence}/100, ${scoreResult.setupQuality})
CHẾ ĐỘ: ${regimeResult.regime} — ${regimeResult.description}

BẢN ĐỒ GIÁ:
- F1M: ${basisResult.f1mPrice} | VN30: ${basisResult.vn30Price}
- Basis: ${basisResult.current > 0 ? '+' : ''}${basisResult.current} (${basisResult.velocity})

DÒNG TIỀN:
- Mua chủ động: ${flowResult.aggression.buyVol} | Bán: ${flowResult.aggression.sellVol}
- Delta: ${flowResult.delta.cumulative} | CVD: ${flowResult.cvd.direction}
- Thanh khoản: ${liquidityResult.volumeRatio}x (${liquidityResult.regime})

BREADTH: ${breadthResult.greenCount}🟢/${breadthResult.redCount}🔴 (xu hướng: ${breadthResult.acceleration.trend})
Bank: ${breadthResult.bank.label}
Tập trung: ${breadthResult.concentration.level}

SCORE: Structure L${scoreResult.breakdown.structure.long}/S${scoreResult.breakdown.structure.short} | Flow L${scoreResult.breakdown.flow.long}/S${scoreResult.breakdown.flow.short} | Cross L${scoreResult.breakdown.crossMarket.long}/S${scoreResult.breakdown.crossMarket.short}

TARGET:
${targetMap.targets.map(t => `${t.type}: ${t.price} (${t.reason})`).join('\n')}
Invalidation: ${targetMap.invalidation.condition}

YÊU CẦU:
1. Đưa ra phán quyết LONG/SHORT dứt khoát, có phải bẫy không?
2. Đánh giá chất lượng cú tăng/giảm hiện tại (thật hay ảo?)
3. 3 lý do chính bằng tiếng Việt dễ hiểu
4. Entry, TP (theo cấu trúc), SL (khi nào luận điểm sai)
5. HTML cho Telegram (<b>, <i>). Ngắn gọn, súc tích.`;

    const result = await model.generateContent(prompt);
    let aiText = result.response.text().replace(/```html/gi, '').replace(/```/g, '').trim();

    let msg = `🤖 <b>DỰ BÁO AI v4.0 — ${sessionLabel}</b>\n`;
    msg += `🕐 <i>${dataFetcher.vnNow()}</i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `${aiText}\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 <i>Đối chiếu: Code → ${scoreResult.direction} ${scoreResult.confidence}/100</i>\n`;
    msg += `<i>🤖 AI VN30F v4.0 | VN Stock Bot</i>`;

    await sendDerivativesMessage(msg);
    console.log(`   ✅ AI Derivatives [${session}] hoàn thành`);
  } catch (err) {
    console.error(`   ❌ AI Derivatives [${session}] lỗi:`, err.message);
  }
}

// ─── DERIVATIVES OI & TAY TO JOB (tối 19h35) ─────────────────
async function runDerivativesOIJob(session = 'evening') {
  if (!isCurrentInstanceActive()) return;

  console.log('\n' + '═'.repeat(55));
  console.log(`📊 DERIVATIVES OI & TAY TO / KHỐI NGOẠI v4.3 — ${session}`);
  console.log('═'.repeat(55));

  try {
    // v4.3: Dùng async version để fetch realtime trước khi build
    const msg = await oiTracker.buildOIEveningNotificationAsync();
    await sendDerivativesMessage(msg);
    console.log(`   ✅ Derivatives OI [${session}] hoàn thành (realtime data)`);
    return true;
  } catch (e) {
    console.error(`   ❌ Derivatives OI [${session}] lỗi:`, e.message);
    return false;
  }
}

// ─── LEADER & TRAP MONITOR ──────────────────────────────────
async function checkMomentum() {
  if (!isCurrentInstanceActive()) return;
  if (!dataFetcher.isMarketHours()) return;

  try {
    const nowTs = Date.now();

    // 1. Check leader exhaustion
    const realtimeVN30 = await dataFetcher.fetchRealtimeVN30();
    const breadthResult = analyzeBreadth(realtimeVN30);
    const leaderResult = analyzeLeaders(breadthResult, _state.prevLeaderSnapshot);
    _state.prevLeaderSnapshot = leaderResult.snapshot;

    if (leaderResult.exhaustion.length > 0) {
      const alertType = 'LEADER_EXHAUSTION';
      const cooldownMs = 20 * 60 * 1000; // 20 phút cooldown
      const lastAlert = _state.lastAlertTime[alertType] || 0;
      if (nowTs - lastAlert > cooldownMs) {
        const msg = buildLeaderAlert(leaderResult.exhaustion);
        await sendDerivativesMessage(msg);
        _state.lastAlertTime[alertType] = nowTs;
      }
    }

    // 2. Check trap
    if (breadthResult.trap.detected && breadthResult.trap.confidence >= 75) {
      const alertType = `TRAP_${breadthResult.trap.detected}`;
      const cooldownMs = 30 * 60 * 1000; // 30 phút cooldown
      const lastAlert = _state.lastAlertTime[alertType] || 0;
      if (nowTs - lastAlert > cooldownMs) {
        const msg = buildTrapAlert(breadthResult);
        await sendDerivativesMessage(msg);
        _state.lastAlertTime[alertType] = nowTs;
      }
    }
  } catch (e) {
    console.error('   ⚠️ Leader/Trap check error:', e.message);
  }
}

function startMomentumMonitor() {
  stopMomentumMonitor();
  const INTERVAL_MS = 90 * 1000;
  _state.momentumTimer = setInterval(() => {
    if (!dataFetcher.isMarketHours()) return;
    checkMomentum().catch(e => console.error('   ⚠️ Momentum error:', e.message));
  }, INTERVAL_MS);
  console.log('   📡 Leader & Trap Monitor: Started (90s)');
}

function stopMomentumMonitor() {
  if (_state.momentumTimer) {
    clearInterval(_state.momentumTimer);
    _state.momentumTimer = null;
  }
}

function stopPositionMonitor() {
  stopMomentumMonitor();
}

// ─── v4.3: PRICE-CHANGE MONITOR ─────────────────────────────────
// Bắn full bản tin phân tích v4.2 khi giá phái sinh biến động >= 4 điểm (bất kể 5p, 10p, 30p)

const _priceHistory = []; // [{ price, ts }] buffer 30p theo dõi biến động rolling
const PRICE_CHANGE_THRESHOLD = 4.0;          // Biến động tối thiểu để bắn noti (điểm)
const PRICE_CHANGE_COOLDOWN = 2 * 60 * 1000; // Cooldown tối thiểu 2p giữa 2 noti
const PRICE_POLL_INTERVAL = 20 * 1000;       // Poll giá mỗi 20 giây
const ROLLING_WINDOW_MS = 30 * 60 * 1000;    // Buffer 30 phút cho rolling swings

async function checkPriceChange() {
  if (!isCurrentInstanceActive()) return;
  if (!dataFetcher.isMarketHours()) return;

  try {
    const futuresPrice = await dataFetcher.fetchRealtimeFuturesPrice();
    if (!futuresPrice || !futuresPrice.price) return;

    const currentPrice = futuresPrice.price;
    const nowTs = Date.now();

    // 1. Ghi nhận giá vào rolling buffer
    _priceHistory.push({ price: currentPrice, ts: nowTs });

    // Xóa data cũ hơn ROLLING_WINDOW_MS (30 phút)
    while (_priceHistory.length > 0 && (nowTs - _priceHistory[0].ts > ROLLING_WINDOW_MS)) {
      _priceHistory.shift();
    }

    // ─── Noti đầu phiên (baseline) ───
    if (!_state.initialNotiSent) {
      const vnHour = dataFetcher.getVnHour ? dataFetcher.getVnHour() : (new Date().getHours() + new Date().getMinutes() / 60);
      const isEarlyMorning = vnHour < 9.083; // Trước ~9h05

      // Nếu trước 9h05: chờ tối thiểu 5p từ lúc mở phiên
      if (isEarlyMorning && (nowTs - _state.lastNotiTime < 5 * 60 * 1000)) {
        return;
      }

      console.log(`   📡 [PriceChange] Bắn noti đầu phiên (baseline): F1M=${currentPrice}`);
      try {
        await runDerivativesSignalJob();
        _state.lastNotiPrice = currentPrice;
        _state.lastNotiTime = nowTs;
        _state.initialNotiSent = true;
        _priceHistory.length = 0;
        _priceHistory.push({ price: currentPrice, ts: nowTs });
      } catch (e) {
        console.error('   ⚠️ [PriceChange] Noti đầu phiên lỗi:', e.message);
      }
      return;
    }

    // ─── Check biến động >= 4 điểm ───
    if (_state.lastNotiPrice === null) {
      _state.lastNotiPrice = currentPrice;
      return;
    }

    const timeSinceLastNoti = nowTs - _state.lastNotiTime;

    // Điều kiện 1: Biến động tích lũy so với lần bắn noti trước >= 4 điểm (bất kể 10p, 30p, 1h)
    const diffFromLastNoti = currentPrice - _state.lastNotiPrice;
    const absDiffLastNoti = Math.abs(diffFromLastNoti);
    let shouldTrigger = false;
    let triggerReason = '';

    if (absDiffLastNoti >= PRICE_CHANGE_THRESHOLD) {
      shouldTrigger = true;
      const dir = diffFromLastNoti > 0 ? '📈 TĂNG' : '📉 GIẢM';
      triggerReason = `${dir} ${absDiffLastNoti.toFixed(1)}đ so với noti trước (${_state.lastNotiPrice.toFixed(1)} → ${currentPrice.toFixed(1)})`;
    }

    // Điều kiện 2: Biến động nhanh trong rolling window >= 4 điểm (bất kể khoảng 2p - 30p)
    // Kích hoạt khi giá hiện tại lệch ít nhất 2.0đ so với noti trước (tránh lặp cùng mức giá)
    if (!shouldTrigger && absDiffLastNoti >= 2.0 && _priceHistory.length >= 2) {
      for (const past of _priceHistory) {
        if (nowTs - past.ts < 60 * 1000) continue; // Cách ít nhất 1 phút
        const swing = currentPrice - past.price;
        const absSwing = Math.abs(swing);
        if (absSwing >= PRICE_CHANGE_THRESHOLD) {
          shouldTrigger = true;
          const minsAgo = Math.round((nowTs - past.ts) / 60000);
          const dir = swing > 0 ? '📈 TĂNG' : '📉 GIẢM';
          triggerReason = `Swing ${minsAgo}p qua: ${dir} ${absSwing.toFixed(1)}đ (${past.price.toFixed(1)} → ${currentPrice.toFixed(1)})`;
          break;
        }
      }
    }

    if (shouldTrigger) {
      if (timeSinceLastNoti < PRICE_CHANGE_COOLDOWN) {
        console.log(`   ⏳ [PriceChange] ${triggerReason} nhưng còn cooldown (${Math.round((PRICE_CHANGE_COOLDOWN - timeSinceLastNoti) / 1000)}s)`);
        return;
      }

      console.log(`\n   🔔 [PriceChange] BIẾN ĐỘNG ≥4đ: ${triggerReason} — BẮN BẢN TIN PHÂN TÍCH v4.2!`);

      try {
        await runDerivativesSignalJob();
        _state.lastNotiPrice = currentPrice;
        _state.lastNotiTime = nowTs;
        // Reset buffer sau khi bắn để tránh trigger lặp
        _priceHistory.length = 0;
        _priceHistory.push({ price: currentPrice, ts: nowTs });
      } catch (e) {
        console.error('   ⚠️ [PriceChange] Signal job lỗi:', e.message);
      }
    }
  } catch (e) {
    console.error('   ⚠️ [PriceChange] Check lỗi:', e.message);
  }
}

function startPriceChangeMonitor() {
  stopPriceChangeMonitor();
  _state.lastNotiTime = Date.now();
  _state.initialNotiSent = false;
  _state.lastNotiPrice = null;
  _priceHistory.length = 0;

  _state.priceChangeTimer = setInterval(() => {
    if (!dataFetcher.isMarketHours()) return;
    checkPriceChange().catch(e => console.error('   ⚠️ [PriceChange] error:', e.message));
  }, PRICE_POLL_INTERVAL);

  console.log(`   📡 Price-Change Monitor v4.3: Started (poll ${PRICE_POLL_INTERVAL / 1000}s, threshold ≥${PRICE_CHANGE_THRESHOLD}đ)`);
}

function stopPriceChangeMonitor() {
  if (_state.priceChangeTimer) {
    clearInterval(_state.priceChangeTimer);
    _state.priceChangeTimer = null;
  }
}

// ─── RESET DAILY ─────────────────────────────────────────
function resetDerivativesState() {
  stopMomentumMonitor();
  stopPriceChangeMonitor();
  _priceHistory.length = 0;
  _state.morningSignal = null;
  _state.afternoonSignal = null;
  _state.prevBasis = null;
  _state.prevLeaderSnapshot = null;
  _state.lastMomentumPrice = null;
  _state.lastMomentumTime = 0;
  _state.lastAlertTime = {};
  _state.prevNotiTimestamp = null;
  _state.prevLiquiditySnapshot = null;
  _state.prevOISnapshot = null;
  _state.prevVN30BuySellSnapshot = null;
  _state.lastNotiPrice = null;
  _state.lastNotiTime = 0;
  _state.initialNotiSent = false;
  dataFetcher.resetDailyCache();
  console.log('   🔄 Derivatives state reset v4.3');
}

// ─── SAVE SNAPSHOT ───────────────────────────────────────────
function _saveSnapshot(analysis) {
  try {
    const { scoreResult, priceMap, basisResult, oiState, flowResult, breadthResult, velocityResult, efficiencyResult, regimeResult, targetMap } = analysis;
    saveSignalSnapshot({
      timestamp: Date.now(),
      direction: scoreResult.direction,
      confidence: scoreResult.confidence,
      setupQuality: scoreResult.setupQuality,
      vn30: basisResult.vn30Price,
      f1m: basisResult.f1mPrice,
      basis: basisResult.current,
      regime: regimeResult.regime,
      breadthGreen: breadthResult.greenCount,
      breadthRed: breadthResult.redCount,
      delta: flowResult.delta.cumulative,
      cvd: flowResult.cvd.direction,
      velocity: velocityResult.current,
      efficiency: efficiencyResult.value,
      vwap: priceMap.vwap,
      poc: priceMap.poc,
      longScore: scoreResult.longScore,
      shortScore: scoreResult.shortScore,
      totalScore: scoreResult.totalScore,
      entry: targetMap.entry,
      targets: targetMap.targets,
      invalidation: targetMap.invalidation,
    });
  } catch (e) {
    console.error('   ⚠️ Snapshot save error:', e.message);
  }
}

// ─── COMPATIBILITY EXPORTS ───────────────────────────────
// Giữ tương thích với cách index.js gọi
module.exports = {
  runDerivativesSignalJob,
  runMorningDerivativesJob,
  runMidMorningDerivativesJob,
  runAfternoonDerivativesJob,
  runAIDerivativesJob,
  runDerivativesOIJob,
  resetDerivativesState,
  startMomentumMonitor,
  stopMomentumMonitor,
  startPriceChangeMonitor,
  stopPriceChangeMonitor,
  stopPositionMonitor,
  oiTracker,
  buildOIEveningNotification: oiTracker.buildOIEveningNotification,
  buildOIEveningNotificationAsync: oiTracker.buildOIEveningNotificationAsync,
  // Legacy compatibility
  fetchOHLCV: dataFetcher.fetchOHLCV,
  fetchVN30LiquidityRadar: async () => null,
  formatRadarBlock: () => '',
  getDerivativesState: () => ({ ..._state }),
};
