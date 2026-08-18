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

const { config } = require('../config');
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
const { buildSignalNotification, buildMomentumAlert, buildLeaderAlert, buildTrapAlert } = require('./notificationBuilder');
const { saveSignalSnapshot } = require('./snapshotStore');

// ─── STATE ───────────────────────────────────────────────────
const _state = {
  morningSignal: null,
  afternoonSignal: null,
  prevBasis: null,
  prevLeaderSnapshot: null,
  lastMomentumPrice: null,
  lastMomentumTime: 0,
  lastAlertTime: {},         // { alertType: timestamp }
  momentumTimer: null,
};

// ─── CORE: Run full 8-layer analysis pipeline ────────────────
async function runFullAnalysis() {
  console.log('   🔮 [v4.0] Chạy pipeline phân tích 8 lớp...');

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
  });

  // ─── LỚP 8: TARGET ENGINE ────────────────────────
  console.log('   🎯 [8/8] Target Engine...');
  const targetMap = buildTargetMap({
    direction: scoreResult.direction,
    priceMap,
    basisResult,
    absorptionResult,
  });

  console.log(`   ✅ Pipeline hoàn thành: ${scoreResult.direction} (${scoreResult.confidence}/100, ${scoreResult.setupQuality})`);

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

// ─── JOB SÁNG ────────────────────────────────────────────────
async function runMorningDerivativesJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL v4.0 — SÁNG');
  console.log('═'.repeat(55));

  try {
    const analysis = await runFullAnalysis();
    _state.morningSignal = analysis;

    const msg = buildSignalNotification('morning', analysis);
    await sendDerivativesMessage(msg);

    // Save snapshot cho backtest
    _saveSnapshot(analysis);

    // Start momentum monitor
    startMomentumMonitor();
  } catch (e) {
    console.error('   ❌ Morning derivatives job error v4.0:', e.message);
  }
}

// ─── JOB GIỮA SÁNG ──────────────────────────────────────────
async function runMidMorningDerivativesJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL v4.0 — GIỮA SÁNG');
  console.log('═'.repeat(55));

  try {
    const analysis = await runFullAnalysis();
    const msg = buildSignalNotification('midmorning', analysis);
    await sendDerivativesMessage(msg);
    _saveSnapshot(analysis);
  } catch (e) {
    console.error('   ❌ Mid-morning derivatives job error v4.0:', e.message);
  }
}

// ─── JOB CHIỀU ───────────────────────────────────────────────
async function runAfternoonDerivativesJob() {
  console.log('\n' + '═'.repeat(55));
  console.log('🔮 DERIVATIVES SIGNAL v4.0 — CHIỀU');
  console.log('═'.repeat(55));

  try {
    const analysis = await runFullAnalysis();
    _state.afternoonSignal = analysis;

    const msg = buildSignalNotification('afternoon', analysis);
    await sendDerivativesMessage(msg);
    _saveSnapshot(analysis);
  } catch (e) {
    console.error('   ❌ Afternoon derivatives job error v4.0:', e.message);
  }
}

// ─── AI DERIVATIVES JOB ─────────────────────────────────────
async function runAIDerivativesJob(session) {
  const sessionLabel = session === 'morning' ? '🌅 SÁNG (9h22)' : session === 'midmorning' ? '⛅ GIỮA SÁNG (10h22)' : '🌆 CHIỀU (13h50)';
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

// ─── DERIVATIVES OI JOB (tối 19h30) ─────────────────────────
async function runDerivativesOIJob(session = 'evening') {
  console.log('\n' + '═'.repeat(55));
  console.log(`📊 DERIVATIVES OI v4.0 — ${session}`);
  console.log('═'.repeat(55));

  try {
    const analysis = await runFullAnalysis();
    const { basisResult, oiState, flowResult, breadthResult, liquidityResult, scoreResult, regimeResult, targetMap } = analysis;

    let msg = `📊 <b>BÁO CÁO OI & BASIS PHÁI SINH — TỔNG KẾT NGÀY</b>\n`;
    msg += `🕐 <i>${dataFetcher.vnNow()}</i>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    // OI
    if (oiState && oiState.totalOI) {
      msg += `🔥 <b>OPEN INTEREST:</b>\n`;
      msg += `   Tổng OI: <b>${oiState.totalOI.toLocaleString('vi-VN')} HĐ</b> (Δ${oiState.oiChange >= 0 ? '+' : ''}${oiState.oiChange})\n`;
      msg += `   Trạng thái: <b>${oiState.description}</b>\n\n`;
    }

    // Basis
    msg += `📐 <b>BASIS:</b>\n`;
    msg += `   F1M: <b>${basisResult.f1mPrice}</b> | VN30: <b>${basisResult.vn30Price}</b>\n`;
    msg += `   Basis: <b>${basisResult.current > 0 ? '+' : ''}${basisResult.current}</b> (${basisResult.basisTrend})\n\n`;

    // Flow summary
    msg += `📊 <b>TỔNG HỢP DÒNG TIỀN:</b>\n`;
    msg += `   Mua: ${flowResult.aggression.buyVol.toLocaleString('vi-VN')} | Bán: ${flowResult.aggression.sellVol.toLocaleString('vi-VN')}\n`;
    msg += `   Delta: ${flowResult.delta.cumulative > 0 ? '+' : ''}${flowResult.delta.cumulative.toLocaleString('vi-VN')}\n`;
    msg += `   Thanh khoản: ${liquidityResult.volumeRatio}x (${liquidityResult.regime})\n`;
    msg += `   NN ròng: ${liquidityResult.foreignNet > 0 ? '+' : ''}${liquidityResult.foreignNet.toFixed(1)} tỷ\n\n`;

    // Breadth
    msg += `🏛️ <b>BREADTH:</b> ${breadthResult.greenCount}🟢 / ${breadthResult.redCount}🔴\n\n`;

    // Score & Direction
    msg += `🔮 <b>DỰ BÁO PHIÊN TỚI:</b>\n`;
    msg += `   ${scoreResult.direction === 'LONG' ? '🟢' : '🔴'} <b>${scoreResult.direction}</b> (${scoreResult.confidence}/100)\n`;
    if (targetMap.targets.length > 0) {
      msg += `   Target: ${targetMap.targets.map(t => t.price.toFixed(1)).join(' → ')}\n`;
    }

    msg += `\n<i>📊 OI Tracker v4.0 | VN Stock Bot</i>`;

    await sendDerivativesMessage(msg);
    console.log(`   ✅ Derivatives OI [${session}] hoàn thành`);
  } catch (e) {
    console.error(`   ❌ Derivatives OI [${session}] lỗi:`, e.message);
  }
}

// ─── MOMENTUM MONITOR ───────────────────────────────────────
async function checkMomentum() {
  if (!dataFetcher.isMarketHours()) return;

  try {
    const vn30Price = await dataFetcher.fetchRealtimeVN30Price();
    if (!vn30Price) return;

    const currentPrice = vn30Price.price;
    const nowTs = Date.now();

    // Biến động ≥ 4 điểm trong 5 phút
    if (_state.lastMomentumPrice !== null) {
      const priceChange = currentPrice - _state.lastMomentumPrice;
      const timeDiffMin = (nowTs - _state.lastMomentumTime) / 60000;

      if (Math.abs(priceChange) >= 4.0 && timeDiffMin <= 6) {
        const alertType = priceChange > 0 ? 'SURGE_UP' : 'SURGE_DOWN';
        const cooldownMs = 5 * 60 * 1000;
        const lastAlert = _state.lastAlertTime[alertType] || 0;

        if (nowTs - lastAlert > cooldownMs) {
          const realtimeVN30 = await dataFetcher.fetchRealtimeVN30();
          const breadthResult = analyzeBreadth(realtimeVN30);
          const msg = buildMomentumAlert(alertType, priceChange, currentPrice, breadthResult);
          await sendDerivativesMessage(msg);
          _state.lastAlertTime[alertType] = nowTs;
        }
      }
    }

    // Check leader exhaustion
    const realtimeVN30 = await dataFetcher.fetchRealtimeVN30();
    const breadthResult = analyzeBreadth(realtimeVN30);
    const leaderResult = analyzeLeaders(breadthResult, _state.prevLeaderSnapshot);
    _state.prevLeaderSnapshot = leaderResult.snapshot;

    if (leaderResult.exhaustion.length > 0) {
      const alertType = 'LEADER_EXHAUSTION';
      const cooldownMs = 10 * 60 * 1000;
      const lastAlert = _state.lastAlertTime[alertType] || 0;
      if (nowTs - lastAlert > cooldownMs) {
        const msg = buildLeaderAlert(leaderResult.exhaustion);
        await sendDerivativesMessage(msg);
        _state.lastAlertTime[alertType] = nowTs;
      }
    }

    // Check trap
    if (breadthResult.trap.detected && breadthResult.trap.confidence >= 70) {
      const alertType = `TRAP_${breadthResult.trap.detected}`;
      const cooldownMs = 15 * 60 * 1000;
      const lastAlert = _state.lastAlertTime[alertType] || 0;
      if (nowTs - lastAlert > cooldownMs) {
        const msg = buildTrapAlert(breadthResult);
        await sendDerivativesMessage(msg);
        _state.lastAlertTime[alertType] = nowTs;
      }
    }

    _state.lastMomentumPrice = currentPrice;
    _state.lastMomentumTime = nowTs;
  } catch (e) {
    console.error('   ⚠️ Momentum check error:', e.message);
  }
}

function startMomentumMonitor() {
  stopMomentumMonitor();
  const INTERVAL_MS = 90 * 1000;
  _state.momentumTimer = setInterval(() => {
    if (!dataFetcher.isMarketHours()) return;
    checkMomentum().catch(e => console.error('   ⚠️ Momentum error:', e.message));
  }, INTERVAL_MS);
  console.log('   📡 Momentum Monitor v4.0: Started (90s)');
}

function stopMomentumMonitor() {
  if (_state.momentumTimer) {
    clearInterval(_state.momentumTimer);
    _state.momentumTimer = null;
  }
}

function stopPositionMonitor() {
  // v4.0: Position monitoring is simplified into momentum monitor
  stopMomentumMonitor();
}

// ─── RESET DAILY ─────────────────────────────────────────────
function resetDerivativesState() {
  stopMomentumMonitor();
  _state.morningSignal = null;
  _state.afternoonSignal = null;
  _state.prevBasis = null;
  _state.prevLeaderSnapshot = null;
  _state.lastMomentumPrice = null;
  _state.lastMomentumTime = 0;
  _state.lastAlertTime = {};
  dataFetcher.resetDailyCache();
  console.log('   🔄 Derivatives state reset v4.0');
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

// ─── COMPATIBILITY EXPORTS ───────────────────────────────────
// Giữ tương thích với cách index.js gọi
module.exports = {
  runMorningDerivativesJob,
  runMidMorningDerivativesJob,
  runAfternoonDerivativesJob,
  runAIDerivativesJob,
  runDerivativesOIJob,
  resetDerivativesState,
  startMomentumMonitor,
  stopMomentumMonitor,
  stopPositionMonitor,
  // Legacy compatibility
  fetchOHLCV: dataFetcher.fetchOHLCV,
  fetchVN30LiquidityRadar: async () => null,
  formatRadarBlock: () => '',
  getDerivativesState: () => ({ ..._state }),
};
