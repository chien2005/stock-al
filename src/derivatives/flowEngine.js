/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📊 VN30F v4.0 — LỚP 3: Flow Engine                       ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Delta/CVD, Aggression, Absorption, Liquidity Sweep,         ║
 * ║  Price Velocity, Directional Efficiency                      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { config } = require('../config');

/**
 * Phân tích Flow (Delta, CVD, Aggression) từ data intraday 1 phút
 * Delta = Aggressive Buy - Aggressive Sell (ước tính từ close vs open)
 */
function analyzeFlow(intradayData) {
  if (!intradayData || !intradayData.c || intradayData.c.length < 5) {
    return _emptyFlow();
  }

  const { o, c, v, t } = intradayData;
  const todayStart = _getTodayStartTs(t);

  let totalBuy = 0;
  let totalSell = 0;
  let totalNeutral = 0;
  const deltaPerBar = [];
  let cvd = 0;
  const cvdHistory = [];

  for (let i = 0; i < c.length; i++) {
    if (t && t[i] < todayStart) continue;
    const vol = v ? v[i] : 0;
    const barOpen = o ? o[i] : c[i];
    const barClose = c[i];

    let buyVol = 0, sellVol = 0;

    if (barClose > barOpen) {
      buyVol = vol;
    } else if (barClose < barOpen) {
      sellVol = vol;
    } else {
      // Doji: dùng so với bar trước
      const prev = i > 0 ? c[i - 1] : barOpen;
      if (barClose > prev) buyVol = vol;
      else if (barClose < prev) sellVol = vol;
      else totalNeutral += vol;
    }

    totalBuy += buyVol;
    totalSell += sellVol;

    const barDelta = buyVol - sellVol;
    deltaPerBar.push(barDelta);
    cvd += barDelta;
    cvdHistory.push(cvd);
  }

  const totalVol = totalBuy + totalSell + totalNeutral;

  // Delta analysis
  const recentDelta = deltaPerBar.slice(-10);
  const deltaTrend = recentDelta.length >= 3
    ? (recentDelta.slice(-3).reduce((s, d) => s + d, 0) > 0 ? 'POSITIVE' : 'NEGATIVE')
    : 'NEUTRAL';

  // CVD direction
  const cvdRecent = cvdHistory.slice(-10);
  let cvdDirection = 'FLAT';
  if (cvdRecent.length >= 5) {
    const cvdStart = cvdRecent[0];
    const cvdEnd = cvdRecent[cvdRecent.length - 1];
    if (cvdEnd > cvdStart + 200) cvdDirection = 'RISING';
    else if (cvdEnd < cvdStart - 200) cvdDirection = 'FALLING';
  }

  // Divergence: Price tăng nhưng CVD giảm (hoặc ngược lại)
  let divergence = null;
  if (intradayData.c.length >= 20) {
    const priceStart = intradayData.c[intradayData.c.length - 20];
    const priceEnd = intradayData.c[intradayData.c.length - 1];
    const priceUp = priceEnd > priceStart + 1;
    const priceDown = priceEnd < priceStart - 1;
    const cvdUp = cvdDirection === 'RISING';
    const cvdDown = cvdDirection === 'FALLING';

    if (priceUp && cvdDown) divergence = 'BEARISH_DIVERGENCE';
    else if (priceDown && cvdUp) divergence = 'BULLISH_DIVERGENCE';
  }

  return {
    delta: {
      current: deltaPerBar.length > 0 ? deltaPerBar[deltaPerBar.length - 1] : 0,
      cumulative: cvd,
      trend: deltaTrend,
      recentSum: recentDelta.reduce((s, d) => s + d, 0),
    },
    cvd: {
      value: cvd,
      direction: cvdDirection,
      divergence,
    },
    aggression: {
      buyVol: totalBuy,
      sellVol: totalSell,
      neutralVol: totalNeutral,
      totalVol,
      ratio: totalSell > 0 ? parseFloat((totalBuy / totalSell).toFixed(2)) : 999,
      dominant: totalBuy > totalSell * 1.15 ? 'BUYERS' : totalSell > totalBuy * 1.15 ? 'SELLERS' : 'BALANCED',
    },
    totalBars: deltaPerBar.length,
  };
}

/**
 * Phát hiện Sell/Buy Absorption
 * Absorption = Volume bán/mua lớn nhưng giá KHÔNG đi tiếp theo hướng đó
 */
function detectAbsorption(intradayData) {
  if (!intradayData || !intradayData.c || intradayData.c.length < 15) {
    return { detected: null, level: null, confidence: 0 };
  }

  const { o, c, v, h, l, t } = intradayData;
  const todayStart = _getTodayStartTs(t);

  // Lấy 15 nến gần nhất
  const start = Math.max(0, c.length - 15);
  const recentCloses = c.slice(start);
  const recentVols = v ? v.slice(start) : [];
  const recentOpens = o ? o.slice(start) : recentCloses;
  const recentLows = l ? l.slice(start) : recentCloses;

  const avgVol = recentVols.length > 0 ? recentVols.reduce((s, x) => s + x, 0) / recentVols.length : 1;

  // Check các nhóm 3 bar gần đây
  for (let i = recentCloses.length - 3; i >= recentCloses.length - 9 && i >= 0; i -= 3) {
    if (i + 2 >= recentCloses.length) continue;

    const barVols = recentVols.slice(i, i + 3);
    const totalVol = barVols.reduce((s, x) => s + x, 0);
    const priceMove = recentCloses[i + 2] - recentCloses[i];

    // Sell Absorption: Volume bán cao nhưng giá giữ/tăng nhẹ
    const isSellBars = recentCloses.slice(i, i + 3).every((c, j) => j === 0 || c <= recentOpens[i + j]);
    if (isSellBars && totalVol > avgVol * 2 && priceMove > -1.5) {
      const absorptionLevel = Math.min(...recentLows.slice(i, i + 3));
      return {
        detected: 'SELL_ABSORPTION',
        level: parseFloat(absorptionLevel.toFixed(1)),
        confidence: Math.min(85, 50 + (totalVol / avgVol) * 10),
        description: `Lực bán mạnh tại ${absorptionLevel.toFixed(1)} nhưng giá không giảm → CẦU đang hấp thụ`,
        actionTip: `Có lực đỡ gom hàng quanh ${absorptionLevel.toFixed(1)} → Không Short đuổi ở vùng này`,
      };
    }

    // Buy Absorption: Volume mua cao nhưng giá giữ/giảm nhẹ
    const isBuyBars = recentCloses.slice(i, i + 3).every((c, j) => j === 0 || c >= recentOpens[i + j]);
    if (isBuyBars && totalVol > avgVol * 2 && priceMove < 1.5) {
      const absorptionLevel = Math.max(...recentCloses.slice(i, i + 3));
      return {
        detected: 'BUY_ABSORPTION',
        level: parseFloat(absorptionLevel.toFixed(1)),
        confidence: Math.min(85, 50 + (totalVol / avgVol) * 10),
        description: `Lực mua mạnh tại ${absorptionLevel.toFixed(1)} nhưng giá không tăng → CUNG đang đè`,
        actionTip: `Có lực đè bán chặn quanh ${absorptionLevel.toFixed(1)} → Không Long đuổi ở vùng này`,
      };
    }
  }

  return { detected: null, level: null, confidence: 0 };
}

/**
 * Phát hiện Liquidity Sweep
 * Giá phá qua S/R → ngay lập tức reverse mạnh = stop hunt / sweep
 */
function detectLiquiditySweep(intradayData, keyLevels) {
  if (!intradayData || !intradayData.c || intradayData.c.length < 10 || !keyLevels) {
    return { detected: false };
  }

  const { h, l, c, t } = intradayData;
  const highs = h || c;
  const lows = l || c;

  // Check 10 bars gần nhất
  const start = Math.max(0, c.length - 10);

  for (let i = start; i < c.length - 2; i++) {
    for (const level of keyLevels) {
      if (!level.price) continue;

      // Sweep down: Giá phá dưới support → reverse lên
      if (level.type === 'SUPPORT' || level.type === 'VAL') {
        if (lows[i] < level.price - 1 && lows[i + 1] > level.price - 2) {
          const sweepDepth = level.price - lows[i];
          const recovery = c[Math.min(i + 2, c.length - 1)] - lows[i];
          if (recovery >= sweepDepth * 1.5 && recovery >= 3) {
            return {
              detected: true,
              direction: 'DOWN_THEN_UP',
              level: level.price,
              sweepLow: parseFloat(lows[i].toFixed(1)),
              recoveryPts: parseFloat(recovery.toFixed(1)),
              description: `Quét thanh khoản dưới ${level.price.toFixed(1)} → bật ngược ${recovery.toFixed(1)} điểm`,
              actionTip: `Đã có bẫy rũ bỏ đáy dưới ${level.price.toFixed(1)} → Ưu tiên canh Long khi giá test lại hỗ trợ`,
              signal: 'BULLISH',
            };
          }
        }
      }

      // Sweep up: Giá phá trên resistance → reverse xuống
      if (level.type === 'RESISTANCE' || level.type === 'VAH') {
        if (highs[i] > level.price + 1 && highs[i + 1] < level.price + 2) {
          const sweepHeight = highs[i] - level.price;
          const decline = highs[i] - c[Math.min(i + 2, c.length - 1)];
          if (decline >= sweepHeight * 1.5 && decline >= 3) {
            return {
              detected: true,
              direction: 'UP_THEN_DOWN',
              level: level.price,
              sweepHigh: parseFloat(highs[i].toFixed(1)),
              declinePts: parseFloat(decline.toFixed(1)),
              description: `Quét thanh khoản trên ${level.price.toFixed(1)} → rơi ngược ${decline.toFixed(1)} điểm`,
              actionTip: `Đã có bẫy kéo vượt đỉnh ${level.price.toFixed(1)} rồi xả → Ưu tiên canh Short khi giá hồi lên gần cản`,
              signal: 'BEARISH',
            };
          }
        }
      }
    }
  }

  return { detected: false };
}

/**
 * Tính Price Velocity (tốc độ biến động giá)
 */
function calculateVelocity(intradayData) {
  if (!intradayData || !intradayData.c || intradayData.c.length < 5) {
    return { current: 0, avg: 0, isImpulse: false, label: 'Bình thường', actionAdvice: 'Biến động ổn định → Thích hợp đi lệnh theo kế hoạch' };
  }

  const { c, t } = intradayData;

  const recentLen = Math.min(10, c.length);
  const velocities = [];

  for (let i = c.length - recentLen; i < c.length - 1; i++) {
    const move = Math.abs(c[i + 1] - c[i]);
    velocities.push(move);
  }

  const current = velocities.length > 0 ? velocities[velocities.length - 1] : 0;
  const avg = velocities.length > 0 ? velocities.reduce((s, v) => s + v, 0) / velocities.length : 0;

  const move5 = Math.abs(c[c.length - 1] - c[Math.max(0, c.length - 6)]);
  const velocity5 = move5 / 5;

  const isImpulse = velocity5 >= 1.5;
  let label = 'Bình thường';
  let actionAdvice = 'Biến động ổn định → Thích hợp đi lệnh theo kế hoạch';

  if (velocity5 >= 3) {
    label = 'Cực nhanh (Giật mạnh)';
    actionAdvice = '⚠️ Dễ bị quét Stoploss, tuyệt đối không mua/bán đuổi';
  } else if (velocity5 >= 1.5) {
    label = 'Rất nhanh';
    actionAdvice = '⚠️ Đợi giá test lại vùng cân bằng, tránh fomo';
  } else if (velocity5 >= 0.8) {
    label = 'Nhanh';
    actionAdvice = 'Đi lệnh dứt khoát khi chạm điểm vào';
  } else if (velocity5 < 0.3) {
    label = 'Chậm / Tích lũy';
    actionAdvice = 'Thị trường đi ngang, kiên nhẫn chờ sóng';
  }

  return {
    current: parseFloat(velocity5.toFixed(2)),
    avg: parseFloat(avg.toFixed(2)),
    isImpulse,
    label,
    actionAdvice,
    move5Pts: parseFloat(move5.toFixed(1)),
    direction: c[c.length - 1] > c[Math.max(0, c.length - 6)] ? 'UP' : 'DOWN',
  };
}

/**
 * Tính Directional Efficiency
 * Efficiency = Net Price Movement / Total Absolute Movement
 */
function calculateEfficiency(intradayData, lookback = 20) {
  if (!intradayData || !intradayData.c || intradayData.c.length < lookback) {
    return { value: 0.5, label: 'Đang theo dõi', actionAdvice: 'Chưa đủ dữ liệu sóng' };
  }

  const c = intradayData.c;
  const start = c.length - lookback;
  const netMove = Math.abs(c[c.length - 1] - c[start]);

  let totalMove = 0;
  for (let i = start + 1; i < c.length; i++) {
    totalMove += Math.abs(c[i] - c[i - 1]);
  }

  const efficiency = totalMove > 0 ? netMove / totalMove : 0;

  let label = 'Bình thường';
  let actionAdvice = 'Giao dịch tỷ trọng vừa phải';

  if (efficiency >= 0.7) {
    label = 'Sóng rất sạch (Dứt khoát)';
    actionAdvice = '✅ Tự tin bám theo xu hướng chính';
  } else if (efficiency >= 0.5) {
    label = 'Sóng khá dứt khoát';
    actionAdvice = '✅ Bám theo sóng, giữ vị thế theo target';
  } else if (efficiency >= 0.35) {
    label = 'Bình thường';
    actionAdvice = 'Giao dịch theo các mốc hỗ trợ / kháng cự';
  } else if (efficiency >= 0.2) {
    label = 'Nhiễu nhiều (Giằng co)';
    actionAdvice = '⚠️ Đứng ngoài hoặc đánh ngắn, chốt lời nhanh';
  } else {
    label = 'Đấu giá 2 chiều (Chop)';
    actionAdvice = '⚠️ Hạn chế giao dịch, chờ bứt phá khỏi vùng hộp';
  }

  return {
    value: parseFloat(efficiency.toFixed(2)),
    label,
    actionAdvice,
    netMove: parseFloat(netMove.toFixed(1)),
    totalMove: parseFloat(totalMove.toFixed(1)),
  };
}

// ─── HELPERS ─────────────────────────────────────────────────
function _getTodayStartTs(timestamps) {
  if (!timestamps || timestamps.length === 0) return 0;
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  vnTime.setHours(0, 0, 0, 0);
  return Math.floor(vnTime.getTime() / 1000);
}

function _emptyFlow() {
  return {
    delta: { current: 0, cumulative: 0, trend: 'NEUTRAL', recentSum: 0 },
    cvd: { value: 0, direction: 'FLAT', divergence: null },
    aggression: { buyVol: 0, sellVol: 0, neutralVol: 0, totalVol: 0, ratio: 1, dominant: 'BALANCED' },
    totalBars: 0,
  };
}

module.exports = {
  analyzeFlow,
  detectAbsorption,
  detectLiquiditySweep,
  calculateVelocity,
  calculateEfficiency,
};
