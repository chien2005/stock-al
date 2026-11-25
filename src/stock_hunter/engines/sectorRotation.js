/**
 * AI STOCK HUNTER - Sector Rotation & Relative Strength Engine
 * Tuân thủ Master Plan V2.0 Section 9:
 * - Equal-weight & median return theo ngành (tránh 1-2 mã trụ kéo lệch toàn ngành, Test M05)
 * - Gắn cờ `lowSample` với ngành <= 3 mã
 * - Phân loại: LEADING | IMPROVING | LAGGING | DISTRIBUTION_RISK | MIXED
 */

const { median } = require('./features');

function evaluateSectorRotation(featureList = [], universeMap = new Map(), supplyDemandMap = new Map()) {
  const buckets = new Map();

  for (const feat of featureList) {
    if (!feat || !Number.isFinite(feat.currentPrice)) continue;
    const meta = universeMap.get(feat.symbol);
    const sector = meta?.sector || 'Khác';
    const sectorCode = meta?.sectorCode || 'OTHER';
    if (!buckets.has(sectorCode)) {
      buckets.set(sectorCode, { sector, sectorCode, items: [] });
    }
    buckets.get(sectorCode).items.push(feat);
  }

  const sectorStates = [];
  for (const bucket of buckets.values()) {
    const items = bucket.items;
    const count = items.length;
    const lowSample = count <= 3;

    const rs20Vals = items.map(i => i.rs20).filter(Number.isFinite);
    const rs5Vals = items.map(i => i.rs5).filter(Number.isFinite);
    const retVals = items.map(i => i.changePct).filter(Number.isFinite);

    const avgRs20 = rs20Vals.length > 0 ? rs20Vals.reduce((a, b) => a + b, 0) / rs20Vals.length : 0;
    const avgRs5 = rs5Vals.length > 0 ? rs5Vals.reduce((a, b) => a + b, 0) / rs5Vals.length : 0;
    const medReturn = median(retVals) || 0;
    const maxReturn = retVals.length > 0 ? Math.max(...retVals) : 0;
    const avgReturn = retVals.length > 0 ? retVals.reduce((a, b) => a + b, 0) / retVals.length : 0;

    let aboveMA20 = 0;
    let ma20Count = 0;
    let demandCount = 0;
    let supplyWarnCount = 0;
    let greenCount = 0;

    for (const item of items) {
      if ((item.changePct || 0) > 0) greenCount++;
      if (item.daily?.ma20) {
        ma20Count++;
        if (item.currentPrice >= item.daily.ma20) aboveMA20++;
      }
      const sd = supplyDemandMap.get(item.symbol);
      if (sd) {
        if (sd.state === 'DEMAND_CONFIRMED' || sd.state === 'DEMAND_CANDIDATE') demandCount++;
        if (sd.state === 'SUPPLY_PRESSURE' || sd.state === 'SUPPLY_WARNING') supplyWarnCount++;
      }
    }

    const breadthMA20 = ma20Count > 0 ? (aboveMA20 / ma20Count) * 100 : 50;
    const concentrationRisk = count >= 3 && (maxReturn - medReturn) >= 2.5 && greenCount < count * 0.5;

    let state = 'MIXED';
    if (supplyWarnCount >= Math.max(2, Math.ceil(count * 0.45)) && avgRs5 < 0) {
      state = 'DISTRIBUTION_RISK';
    } else if (concentrationRisk) {
      state = 'MIXED';
    } else if (avgRs20 > 1.0 && breadthMA20 >= 60) {
      state = 'LEADING';
    } else if (avgRs5 > 0.8 && avgRs20 <= 1.0 && breadthMA20 >= 40) {
      state = 'IMPROVING';
    } else if (avgRs20 < -1.5 && breadthMA20 < 40) {
      state = 'LAGGING';
    }

    // Score ngành 0-100 (seed weights Section 9: 30% RS20, 20% RS5, 25% breadth, 15% demand, 10% stability)
    const rs20Score = Math.max(0, Math.min(30, 15 + avgRs20 * 1.5));
    const rs5Score = Math.max(0, Math.min(20, 10 + avgRs5 * 2.0));
    const breadthScore = Math.max(0, Math.min(25, (breadthMA20 / 100) * 25));
    const demandScore = Math.max(0, Math.min(15, count > 0 ? (demandCount / count) * 25 : 0));
    const stabilityScore = concentrationRisk ? 3 : lowSample ? 5 : 10;
    const score = Math.round(rs20Score + rs5Score + breadthScore + demandScore + stabilityScore);

    sectorStates.push({
      sector: bucket.sector,
      sectorCode: bucket.sectorCode,
      symbolCount: count,
      lowSample,
      concentrationRisk,
      avgRs20: parseFloat(avgRs20.toFixed(2)),
      avgRs5: parseFloat(avgRs5.toFixed(2)),
      avgReturnPct: parseFloat(avgReturn.toFixed(2)),
      medianReturnPct: parseFloat(medReturn.toFixed(2)),
      breadthMA20Pct: parseFloat(breadthMA20.toFixed(1)),
      demandCount,
      supplyWarnCount,
      state,
      score,
    });
  }

  sectorStates.sort((a, b) => b.score - a.score);
  return {
    sectors: sectorStates,
    sectorMap: new Map(sectorStates.map(s => [s.sectorCode, s])),
  };
}

module.exports = { evaluateSectorRotation };
