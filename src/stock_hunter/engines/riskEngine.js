/**
 * AI STOCK HUNTER - Portfolio Risk & Sizing Engine (Vốn 60 triệu VND)
 * Tuân thủ Master Plan V2.0 Section 17:
 * - Joint allocation (phân bổ đồng thời cash, risk, stress, symbol cap, cluster cap, regime cap)
 * - Làm tròn xuống lô chẵn 100 cp; không đủ 100 cp -> NO_TRADE_SIZE (Tests R05, R06, R07)
 * - Kill switch drawdown >= 8%, daily guard >= 2%, weekly guard >= 4% (Test R10)
 * - Tính PnL ròng chuẩn xác sau phí mua/bán + thuế bán 0.1% (Test R12)
 */

const { STOCK_HUNTER_CONFIG } = require('../config/stockHunterConfig');
const { getInstrumentMeta } = require('../config/universeSeed');

function calculateNetPnL({
  buyPriceVnd,
  sellPriceVnd,
  qty,
  buyFeeRate = STOCK_HUNTER_CONFIG.risk.buyFeeRate,
  sellFeeRate = STOCK_HUNTER_CONFIG.risk.sellFeeRate,
  sellTaxRate = STOCK_HUNTER_CONFIG.risk.sellTaxRate,
}) {
  const buyGross = qty * buyPriceVnd;
  const buyFee = Math.round(buyGross * buyFeeRate);
  const buyTotalCash = buyGross + buyFee;

  const sellGross = qty * sellPriceVnd;
  const sellFee = Math.round(sellGross * sellFeeRate);
  const sellTax = Math.round(sellGross * sellTaxRate); // Thuế bán 0.1% thu cả khi lỗ
  const sellNetCash = sellGross - sellFee - sellTax;

  const netPnlVnd = sellNetCash - buyTotalCash;
  const netPnlPct = buyTotalCash > 0 ? parseFloat(((netPnlVnd / buyTotalCash) * 100).toFixed(2)) : 0;

  return {
    buyGross,
    buyFee,
    buyTotalCash,
    sellGross,
    sellFee,
    sellTax,
    sellNetCash,
    netPnlVnd,
    netPnlPct,
  };
}

/**
 * Tính trạng thái rủi ro hiện tại của danh mục từ Ledger + Giá thị trường
 */
function computePortfolioRiskState(ledgerSnapshot, quotesBySymbol = new Map(), marketRegime = null) {
  const cfg = STOCK_HUNTER_CONFIG.risk;
  const openLots = (ledgerSnapshot?.positionLots || []).filter(l => l.qty > 0);
  const availableCashVnd = ledgerSnapshot?.availableCashVnd ?? cfg.initialNavVnd;
  const pendingReceivableVnd = ledgerSnapshot?.pendingReceivableVnd ?? 0;
  const payableVnd = ledgerSnapshot?.payableVnd ?? 0;

  let markedHoldingsVnd = 0;
  let plannedOpenRiskVnd = 0;
  let stressedOpenLossVnd = 0;
  const symbolExposureMap = new Map();
  const clusterExposureMap = new Map();
  const activeSymbols = new Set();

  for (const lot of openLots) {
    const q = quotesBySymbol instanceof Map ? quotesBySymbol.get(lot.symbol) : quotesBySymbol[lot.symbol];
    const markPrice = q?.priceVnd || lot.lastPriceVnd || lot.entryPriceVnd;
    const mktVal = lot.qty * markPrice;
    markedHoldingsVnd += mktVal;
    activeSymbols.add(lot.symbol);

    const stopPrice = lot.stopVnd || Math.round(lot.entryPriceVnd * 0.96);
    const riskPerShare = Math.max(0, markPrice - stopPrice + markPrice * (cfg.sellFeeRate + cfg.sellTaxRate));
    plannedOpenRiskVnd += lot.qty * riskPerShare;
    stressedOpenLossVnd += lot.qty * Math.round(markPrice * cfg.tPlus2StressShockPct);

    symbolExposureMap.set(lot.symbol, (symbolExposureMap.get(lot.symbol) || 0) + mktVal);
    const cluster = lot.riskCluster || getInstrumentMeta(lot.symbol).riskCluster;
    clusterExposureMap.set(cluster, (clusterExposureMap.get(cluster) || 0) + mktVal);
  }

  const navVnd = Math.round(availableCashVnd + markedHoldingsVnd + pendingReceivableVnd - payableVnd);
  const navPeakVnd = Math.max(ledgerSnapshot?.navPeakVnd || cfg.initialNavVnd, navVnd);
  const drawdownPct = navPeakVnd > 0 ? (navPeakVnd - navVnd) / navPeakVnd : 0;

  const dailyStartNav = ledgerSnapshot?.dailyStartNavVnd || navVnd;
  const weeklyStartNav = ledgerSnapshot?.weeklyStartNavVnd || navVnd;
  const dailyLossPct = dailyStartNav > 0 ? Math.max(0, (dailyStartNav - navVnd) / dailyStartNav) : 0;
  const weeklyLossPct = weeklyStartNav > 0 ? Math.max(0, (weeklyStartNav - navVnd) / weeklyStartNav) : 0;

  const killSwitchTriggered = ledgerSnapshot?.killSwitchActive === true || drawdownPct >= cfg.drawdownKill;
  const dailyGuardHit = dailyLossPct >= cfg.dailyLossGuard;
  const weeklyGuardHit = weeklyLossPct >= cfg.weeklyLossGuard;
  const drawdownReviewHit = drawdownPct >= cfg.drawdownReview;

  const regimeExposureCap = marketRegime?.exposureCap ?? 0;
  const maxAllowedHoldingsVnd = navVnd * regimeExposureCap * (drawdownReviewHit ? 0.5 : 1.0);
  const remainingRegimeExposureVnd = Math.max(0, maxAllowedHoldingsVnd - markedHoldingsVnd);

  const entryBlocked =
    ledgerSnapshot?.ledgerStale === true ||
    killSwitchTriggered ||
    dailyGuardHit ||
    weeklyGuardHit ||
    regimeExposureCap <= 0 ||
    activeSymbols.size >= cfg.maxPositions;

  const blockReasons = [];
  if (ledgerSnapshot?.ledgerStale) blockReasons.push('LEDGER_STALE');
  if (killSwitchTriggered) blockReasons.push(`DRAWDOWN_KILL_${(drawdownPct * 100).toFixed(2)}%`);
  if (dailyGuardHit) blockReasons.push(`DAILY_LOSS_GUARD_${(dailyLossPct * 100).toFixed(2)}%`);
  if (weeklyGuardHit) blockReasons.push(`WEEKLY_LOSS_GUARD_${(weeklyLossPct * 100).toFixed(2)}%`);
  if (regimeExposureCap <= 0) blockReasons.push(`REGIME_${marketRegime?.regime || 'UNKNOWN'}_NO_ENTRY`);
  if (activeSymbols.size >= cfg.maxPositions) blockReasons.push(`MAX_POSITIONS_${cfg.maxPositions}`);

  return {
    navVnd,
    navPeakVnd,
    availableCashVnd,
    markedHoldingsVnd,
    plannedOpenRiskVnd,
    stressedOpenLossVnd,
    drawdownPct: parseFloat((drawdownPct * 100).toFixed(2)),
    dailyLossPct: parseFloat((dailyLossPct * 100).toFixed(2)),
    weeklyLossPct: parseFloat((weeklyLossPct * 100).toFixed(2)),
    killSwitchTriggered,
    drawdownReviewHit,
    entryBlocked,
    blockReasons,
    activeSymbols,
    symbolExposureMap,
    clusterExposureMap,
    remainingRegimeExposureVnd,
    remainingPlannedRiskVnd: Math.max(0, navVnd * cfg.maxPlannedOpenRisk - plannedOpenRiskVnd),
    remainingStressBudgetVnd: Math.max(0, navVnd * cfg.maxStressedLoss - stressedOpenLossVnd),
  };
}

/**
 * Phân bổ size đồng thời cho danh sách ứng viên đã được sắp xếp theo ưu tiên (Joint Allocation)
 */
function allocatePortfolioCandidates(rankedCandidates, ledgerSnapshot, quotesBySymbol = new Map(), marketRegime = null) {
  const cfg = STOCK_HUNTER_CONFIG.risk;
  const state = computePortfolioRiskState(ledgerSnapshot, quotesBySymbol, marketRegime);

  let remCash = state.availableCashVnd;
  let remPlannedRisk = state.remainingPlannedRiskVnd;
  let remStressBudget = state.remainingStressBudgetVnd;
  let remRegimeExp = state.remainingRegimeExposureVnd;
  let openPositionSlots = Math.max(0, cfg.maxPositions - state.activeSymbols.size);

  const symExp = new Map(state.symbolExposureMap);
  const clusterExp = new Map(state.clusterExposureMap);
  const allocated = [];

  for (const cand of rankedCandidates) {
    const plan = cand.tradePlan;
    if (!plan || !plan.valid) {
      allocated.push({ ...cand, allocationStatus: 'REJECTED_PLAN', recommendedQty: 0 });
      continue;
    }

    if (state.entryBlocked) {
      allocated.push({
        ...cand,
        allocationStatus: 'WATCH_RISK_BLOCKED',
        allocationReasons: state.blockReasons,
        recommendedQty: 0,
      });
      continue;
    }

    // Không mở trùng mã đã đang giữ (MVP không DCA / nhồi thêm tùy tiện, Section 18.3)
    if (state.activeSymbols.has(cand.symbol)) {
      allocated.push({
        ...cand,
        allocationStatus: 'SKIP_ALREADY_HOLDING',
        allocationReasons: ['NO_PYRAMIDING_IN_MVP'],
        recommendedQty: 0,
      });
      continue;
    }

    if (openPositionSlots <= 0) {
      allocated.push({
        ...cand,
        allocationStatus: 'WATCH_CAPITAL_SLOTS_FULL',
        allocationReasons: ['MAX_POSITIONS_REACHED'],
        recommendedQty: 0,
      });
      continue;
    }

    const cluster = cand.riskCluster || getInstrumentMeta(cand.symbol).riskCluster;
    const riskPct = (cand.isReversal ? cfg.reversalRiskPerTrade : cfg.riskPerTrade) * (state.drawdownReviewHit ? 0.5 : 1.0);
    const tradeRiskBudget = Math.min(state.navVnd * riskPct, remPlannedRisk);

    const qRisk = Math.floor(tradeRiskBudget / plan.netRiskPerShare);
    const qStress = Math.floor(remStressBudget / Math.max(1, plan.stressedLossPerShare));
    const worstEntryCashPerShare = plan.entryWorst * (1 + cfg.buyFeeRate);
    const qCash = Math.floor(remCash / worstEntryCashPerShare);

    const symCapRem = Math.max(0, state.navVnd * cfg.maxSymbolExposure - (symExp.get(cand.symbol) || 0));
    const qSymbol = Math.floor(symCapRem / plan.entryWorst);

    const clusterCapRem = Math.max(0, state.navVnd * cfg.maxClusterExposure - (clusterExp.get(cluster) || 0));
    const qCluster = Math.floor(clusterCapRem / plan.entryWorst);

    const qRegime = Math.floor(remRegimeExp / plan.entryWorst);

    // Thanh khoản: không vượt quá 2% khối lượng trung bình 20 phiên (tránh trượt giá)
    const medVol20 = cand.medianVol20 || 0;
    const qLiquidity = medVol20 > 0 ? Math.floor(medVol20 * 0.02) : Number.MAX_SAFE_INTEGER;

    const rawMin = Math.min(qRisk, qStress, qCash, qSymbol, qCluster, qRegime, qLiquidity);
    const qFinal = Math.floor(Math.max(0, rawMin) / cfg.lotSize) * cfg.lotSize;

    if (qFinal < cfg.lotSize) {
      const capLimits = [];
      if (qSymbol < cfg.lotSize) capLimits.push('SYMBOL_CAP_35%_EXCEEDED');
      if (qCluster < cfg.lotSize) capLimits.push('CLUSTER_CAP_40%_EXCEEDED');
      if (qCash < cfg.lotSize) capLimits.push('INSUFFICIENT_CASH');
      if (qRisk < cfg.lotSize) capLimits.push('INSUFFICIENT_RISK_BUDGET');
      if (qStress < cfg.lotSize) capLimits.push('INSUFFICIENT_STRESS_BUDGET');
      if (qRegime < cfg.lotSize) capLimits.push('REGIME_EXPOSURE_FULL');

      allocated.push({
        ...cand,
        allocationStatus: 'NO_TRADE_SIZE',
        allocationReasons: capLimits.length > 0 ? capLimits : ['BELOW_1_LOT_100'],
        recommendedQty: 0,
      });
      continue;
    }

    // Reserve ngân sách đồng thời (Test R08, R09)
    const usedCash = Math.round(qFinal * worstEntryCashPerShare);
    const usedVal = qFinal * plan.entryWorst;
    remCash -= usedCash;
    remPlannedRisk -= qFinal * plan.netRiskPerShare;
    remStressBudget -= qFinal * plan.stressedLossPerShare;
    remRegimeExp -= usedVal;
    openPositionSlots -= 1;

    symExp.set(cand.symbol, (symExp.get(cand.symbol) || 0) + usedVal);
    clusterExp.set(cluster, (clusterExp.get(cluster) || 0) + usedVal);

    allocated.push({
      ...cand,
      allocationStatus: 'APPROVED_BUY',
      recommendedQty: qFinal,
      estimatedCashRequiredVnd: usedCash,
      plannedRiskVnd: qFinal * plan.netRiskPerShare,
      riskPctOfNav: parseFloat((((qFinal * plan.netRiskPerShare) / state.navVnd) * 100).toFixed(2)),
    });
  }

  return {
    portfolioRiskState: state,
    allocated,
  };
}

module.exports = {
  calculateNetPnL,
  computePortfolioRiskState,
  allocatePortfolioCandidates,
};
