/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🏛️ VN30F v4.0 — LỚP 5: Breadth & Leaders Engine         ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Breadth Acceleration, Index Concentration,                  ║
 * ║  Leader Exhaustion, Rotation, Trap Detection                 ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');
const { addBreadthSnapshot, getBreadthSnapshots } = require('./dataFetcher');

const PILLAR_SYMBOLS = ['VCB', 'VIC', 'VHM', 'BID', 'CTG', 'FPT', 'MWG', 'GAS', 'HPG', 'STB', 'TCB', 'LPB'];
const VIN_SYMBOLS = ['VIC', 'VHM', 'VRE'];
const BANK_SYMBOLS = ['VCB', 'BID', 'CTG', 'TCB', 'MBB', 'VPB', 'STB', 'ACB'];

/**
 * Phân tích Breadth đầy đủ (mở rộng từ v3.0)
 */
function analyzeBreadth(realtimeVN30) {
  if (!realtimeVN30 || !realtimeVN30.raw || realtimeVN30.raw.length === 0) {
    return _emptyBreadth();
  }

  const { raw, components } = realtimeVN30;
  let greenCount = 0, redCount = 0, neutralCount = 0;
  let strongBull = 0, bull = 0, mildBull = 0;
  let strongBear = 0, bear = 0, mildBear = 0;
  const details = [];
  const pillarDetails = [];

  for (const comp of components) {
    const rawData = raw.find(r => r.sym === comp.sym);
    if (!rawData) continue;

    let price = parseFloat(rawData.lastPrice || 0) * 1000;
    const refPrice = parseFloat(rawData.r || 0) * 1000;
    if (refPrice <= 0) continue;
    if (price <= 0) price = refPrice;

    const changePct = ((price - refPrice) / refPrice) * 100;
    const absPct = Math.abs(changePct);

    const item = {
      sym: comp.sym,
      changePct: parseFloat(changePct.toFixed(2)),
      price,
      refPrice,
      weight: comp.weight || 1,
      isPillar: PILLAR_SYMBOLS.includes(comp.sym),
    };
    details.push(item);

    if (changePct > 0.05) {
      greenCount++;
      if (absPct >= 4) strongBull++;
      else if (absPct >= 1.2) bull++;
      else mildBull++;
    } else if (changePct < -0.05) {
      redCount++;
      if (absPct >= 4) strongBear++;
      else if (absPct >= 1.2) bear++;
      else mildBear++;
    } else {
      neutralCount++;
    }

    if (PILLAR_SYMBOLS.includes(comp.sym)) {
      pillarDetails.push(item);
    }
  }

  // ─── Breadth Snapshot & Acceleration ──────────────
  const snapshot = { green: greenCount, red: redCount, neutral: neutralCount };
  addBreadthSnapshot(snapshot);

  const snapshots = getBreadthSnapshots();
  let acceleration = 0;
  let trend = 'STABLE';

  if (snapshots.length >= 3) {
    const recent3 = snapshots.slice(-3);
    const greenChange = recent3[recent3.length - 1].green - recent3[0].green;
    acceleration = greenChange;

    if (greenChange >= 4) trend = 'IMPROVING';
    else if (greenChange <= -4) trend = 'DETERIORATING';
  }

  // ─── Index Concentration ──────────────────────────
  const sorted = [...details].sort((a, b) => Math.abs(b.changePct * b.weight) - Math.abs(a.changePct * a.weight));
  const topContributors = sorted.slice(0, 5).map(d => ({
    sym: d.sym,
    contribution: parseFloat((d.changePct * d.weight / 100).toFixed(2)),
    changePct: d.changePct,
  }));

  const totalContribution = details.reduce((s, d) => s + Math.abs(d.changePct * d.weight / 100), 0);
  const top3Contribution = topContributors.slice(0, 3).reduce((s, c) => s + Math.abs(c.contribution), 0);
  const concentrationRatio = totalContribution > 0 ? top3Contribution / totalContribution : 0;

  let concentrationLevel = 'LOW';
  if (concentrationRatio >= 0.7) concentrationLevel = 'HIGH';
  else if (concentrationRatio >= 0.5) concentrationLevel = 'MEDIUM';

  // ─── Trap Detection (nâng cấp từ v3.0) ───────────
  let trapDetected = null;
  let trapConfidence = 0;
  const maxGreenPct = details.filter(d => d.changePct > 0).reduce((max, d) => Math.max(max, d.changePct), 0);
  const maxRedPct = details.filter(d => d.changePct < 0).reduce((max, d) => Math.max(max, Math.abs(d.changePct)), 0);

  if (greenCount >= 20 && strongBull === 0 && bull === 0 && maxGreenPct < 1.2) {
    trapDetected = 'TRAP_LONG';
    trapConfidence = greenCount >= 24 ? 85 : 70;
  }
  if (redCount >= 20 && strongBear === 0 && bear === 0 && maxRedPct < 1.2) {
    trapDetected = 'TRAP_SHORT';
    trapConfidence = redCount >= 24 ? 85 : 70;
  }

  // ─── Synchronized Move ────────────────────────────
  const avgGreenPct = details.filter(d => d.changePct > 0).length > 0
    ? details.filter(d => d.changePct > 0).reduce((s, d) => s + d.changePct, 0) / details.filter(d => d.changePct > 0).length : 0;
  const avgRedPct = details.filter(d => d.changePct < 0).length > 0
    ? Math.abs(details.filter(d => d.changePct < 0).reduce((s, d) => s + d.changePct, 0) / details.filter(d => d.changePct < 0).length) : 0;

  let synchronizedMove = null;
  if (greenCount >= 22 && (bull + strongBull) >= 5 && avgGreenPct >= 1.0) synchronizedMove = 'SYNC_BULL';
  if (redCount >= 22 && (bear + strongBear) >= 5 && avgRedPct >= 1.0) synchronizedMove = 'SYNC_BEAR';

  // ─── Bank Participation ───────────────────────────
  const bankDetails = details.filter(d => BANK_SYMBOLS.includes(d.sym));
  const bankGreen = bankDetails.filter(d => d.changePct > 0.05).length;
  const bankParticipation = bankDetails.length > 0 ? bankGreen / bankDetails.length : 0;
  let bankLabel = 'THẤP';
  if (bankParticipation >= 0.75) bankLabel = 'CAO';
  else if (bankParticipation >= 0.5) bankLabel = 'TRUNG BÌNH';

  return {
    greenCount, redCount, neutralCount,
    bands: { strongBull, bull, mildBull, strongBear, bear, mildBear, maxGreenPct: parseFloat(maxGreenPct.toFixed(2)), maxRedPct: parseFloat(maxRedPct.toFixed(2)), avgGreenPct: parseFloat(avgGreenPct.toFixed(2)), avgRedPct: parseFloat(avgRedPct.toFixed(2)) },
    acceleration: { value: acceleration, trend, snapshots: snapshots.slice(-5) },
    concentration: { topContributors, top3Contribution: parseFloat(top3Contribution.toFixed(2)), ratio: parseFloat(concentrationRatio.toFixed(2)), level: concentrationLevel },
    bank: { greenCount: bankGreen, totalCount: bankDetails.length, participation: parseFloat(bankParticipation.toFixed(2)), label: bankLabel, details: bankDetails },
    trap: { detected: trapDetected, confidence: trapConfidence },
    synchronizedMove,
    pillarDetails,
    details: [...details].sort((a, b) => b.changePct - a.changePct),
  };
}

/**
 * Phân tích Leader Exhaustion + Rotation
 * Tracking GAS, VIC, VCB, FPT, VHM, BID
 */
function analyzeLeaders(breadthResult, prevLeaderSnapshot) {
  if (!breadthResult || !breadthResult.pillarDetails) {
    return { exhaustion: [], rotation: null, snapshot: {} };
  }

  const leaders = ['GAS', 'VIC', 'VCB', 'FPT', 'VHM', 'BID'];
  const exhaustion = [];
  const currentSnapshot = {};

  for (const sym of leaders) {
    const detail = breadthResult.pillarDetails.find(p => p.sym === sym);
    if (!detail) continue;

    currentSnapshot[sym] = detail.changePct;

    const prevPct = prevLeaderSnapshot ? prevLeaderSnapshot[sym] : null;
    if (prevPct === null || prevPct === undefined) continue;

    // Phát hiện exhaustion: trước đó tăng mạnh, giờ giảm
    if (prevPct >= 2 && detail.changePct < prevPct - 0.5) {
      const retracement = parseFloat((prevPct - detail.changePct).toFixed(2));
      exhaustion.push({
        sym,
        peak: prevPct,
        current: detail.changePct,
        retracement,
        status: retracement >= 2 ? 'REVERSED' : 'EXHAUSTING',
      });
    }

    // Trụ quay đầu từ giảm sang tăng
    if (prevPct <= -2 && detail.changePct > prevPct + 0.5) {
      exhaustion.push({
        sym,
        peak: prevPct,
        current: detail.changePct,
        retracement: parseFloat((detail.changePct - prevPct).toFixed(2)),
        status: 'RECOVERING',
      });
    }
  }

  // ─── Leader Rotation ──────────────────────────────
  // Ai đang dẫn? So sánh với snapshot trước
  let rotation = null;
  if (prevLeaderSnapshot && Object.keys(prevLeaderSnapshot).length >= 3) {
    // Tìm leader hiện tại và trước đó
    const currentLeader = Object.entries(currentSnapshot)
      .sort(([, a], [, b]) => b - a)[0];
    const prevLeader = Object.entries(prevLeaderSnapshot)
      .sort(([, a], [, b]) => b - a)[0];

    if (currentLeader && prevLeader && currentLeader[0] !== prevLeader[0]) {
      rotation = {
        from: prevLeader[0],
        to: currentLeader[0],
        description: `Trụ dẫn dắt xoay từ ${prevLeader[0]} sang ${currentLeader[0]}`,
      };
    }
  }

  return { exhaustion, rotation, snapshot: currentSnapshot };
}

/**
 * Phân tích thanh khoản VN30 (nâng cấp từ radar v3.0)
 * Không suy luận direction từ volume — chỉ đánh giá risk
 */
function analyzeLiquidity(realtimeVN30, dailyVNIndex) {
  if (!realtimeVN30 || !realtimeVN30.raw || realtimeVN30.raw.length === 0) {
    return { totalValue: 0, volumeRatio: 1, foreignNet: 0, regime: 'NORMAL', riskModifier: 0 };
  }

  const { raw } = realtimeVN30;
  let totalTradeValue = 0;
  let totalFnBuyValue = 0;
  let totalFnSellValue = 0;

  for (const r of raw) {
    if (!r.sym) continue;
    const price = parseFloat(r.lastPrice || 0) * 1000;
    const vol = parseInt(r.lot || 0) * 10;
    const fBuy = parseInt(r.fBVol || 0) * 10;
    const fSell = parseInt(r.fSVolume || 0) * 10;

    if (price > 0) {
      totalTradeValue += (vol * price) / 1e9;
      totalFnBuyValue += (fBuy * price) / 1e9;
      totalFnSellValue += (fSell * price) / 1e9;
    }
  }

  const foreignNet = parseFloat((totalFnBuyValue - totalFnSellValue).toFixed(1));

  // Volume ratio vs TB5 phiên
  let volumeRatio = 1.0;
  if (dailyVNIndex && dailyVNIndex.v && dailyVNIndex.v.length >= 5) {
    const avg5 = dailyVNIndex.v.slice(-6, -1).reduce((s, v) => s + v, 0) / 5;
    const todayVol = dailyVNIndex.v[dailyVNIndex.v.length - 1];
    volumeRatio = avg5 > 0 ? parseFloat((todayVol / avg5).toFixed(2)) : 1.0;
  }

  // Regime: CHỈ dùng làm risk modifier, KHÔNG suy luận direction
  let regime = 'NORMAL';
  let riskModifier = 0;
  if (volumeRatio < 0.6 || totalTradeValue < 2000) {
    regime = 'CẠN'; // Thanh khoản rất thấp → tín hiệu kém tin cậy hơn
    riskModifier = -15; // Giảm confidence 15 điểm
  } else if (volumeRatio < 0.8) {
    regime = 'THẤP';
    riskModifier = -8;
  } else if (volumeRatio >= 1.3) {
    regime = 'CAO';
    riskModifier = 5; // Tăng confidence nhẹ
  }

  return {
    totalValue: parseFloat(totalTradeValue.toFixed(1)),
    volumeRatio,
    foreignNet,
    foreignBuy: parseFloat(totalFnBuyValue.toFixed(1)),
    foreignSell: parseFloat(totalFnSellValue.toFixed(1)),
    regime,
    riskModifier,
  };
}

// ─── EMPTY BREADTH ───────────────────────────────────────────
function _emptyBreadth() {
  return {
    greenCount: 0, redCount: 0, neutralCount: 0,
    bands: { strongBull: 0, bull: 0, mildBull: 0, strongBear: 0, bear: 0, mildBear: 0, maxGreenPct: 0, maxRedPct: 0, avgGreenPct: 0, avgRedPct: 0 },
    acceleration: { value: 0, trend: 'STABLE', snapshots: [] },
    concentration: { topContributors: [], top3Contribution: 0, ratio: 0, level: 'LOW' },
    bank: { greenCount: 0, totalCount: 0, participation: 0, label: 'THẤP', details: [] },
    trap: { detected: null, confidence: 0 },
    synchronizedMove: null,
    pillarDetails: [],
    details: [],
  };
}

module.exports = {
  analyzeBreadth,
  analyzeLeaders,
  analyzeLiquidity,
  PILLAR_SYMBOLS,
  BANK_SYMBOLS,
  VIN_SYMBOLS,
};
