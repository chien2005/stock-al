/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔮 VN30F V10.0 — Pre-Move Setup Detectors (P01 to P18)      ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  18 Leading Pre-Move Setup Detectors (SRS Section 8):         ║
 * ║  P01/P02: Compression under resistance / above support        ║
 * ║  P03/P04: Slow reversal / deceleration (e.g. 62 -> 50 top)   ║
 * ║  P05/P06: Exhaustion at zone + early rebound (cung/cầu kiệt)  ║
 * ║  P07/P08: Trend pullback ending                               ║
 * ║  P09/P10: Low supply rally / Low demand decline (30 -> 40)    ║
 * ║  P11/P12: Basis divergence / F1 lead                          ║
 * ║  P13/P14: Pre-shock pressure candidate                        ║
 * ║  P15/P16: Failed continuation / Trap preparation              ║
 * ║  P17:     Range rotation                                      ║
 * ║  P18:     Open / Reopen displacement (gap sau trưa)           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class PreMoveDetector {
  /**
   * Run all 18 pre-move detectors against current feature bundle.
   * @param {object} params
   * @returns {object[]} Array of setup candidates
   */
  detectAll({
    currentPrice,
    featureBundle,
    candles = [],
    zones = [],
    sessionMemory,
    clock,
  }) {
    const candidates = [];
    if (!featureBundle || typeof currentPrice !== 'number' || currentPrice <= 0) {
      return candidates;
    }

    const { g1Structure, g2Pressure, g3Dynamics, g4Location, g5CrossMarket, g6Context } = featureBundle;

    // ─────────────────────────────────────────────────────────────
    // P01/P02: Compression under resistance / above support
    // ─────────────────────────────────────────────────────────────
    if (g4Location.nearestResistance && g4Location.distToResistance !== null) {
      if (g4Location.distToResistance <= 2.5 && g3Dynamics.isCompressing && g1Structure.hhhlPattern === 'HIGHER_HIGHS') {
        candidates.push({
          setupId: 'P01_BULLISH_COMPRESSION',
          name: 'Nén giá sát kháng cự (Chuẩn bị ép phá cản)',
          direction: 'UP',
          horizon: 'H_SWING', // 5m
          targetHint: g4Location.nearestResistance.high + 1.0,
          invalidationHint: currentPrice - 2.0,
          leadingEvidence: [
            `Giá ép sát cản ${g4Location.nearestResistance.low}–${g4Location.nearestResistance.high} (cách ${g4Location.distToResistance.toFixed(1)}đ)`,
            'Đáy cấu trúc nâng dần (Higher Lows)',
            'Biên độ dao động co thắt (Volatility Compression)',
          ],
          counterEvidence: [],
          rawScore: 78,
          stage: 'EARLY_FORECAST',
        });
      }
    }

    if (g4Location.nearestSupport && g4Location.distToSupport !== null) {
      if (g4Location.distToSupport <= 2.5 && g3Dynamics.isCompressing && g1Structure.hhhlPattern === 'LOWER_HIGHS') {
        candidates.push({
          setupId: 'P02_BEARISH_COMPRESSION',
          name: 'Nén giá sát hỗ trợ (Chuẩn bị ép thủng đáy)',
          direction: 'DOWN',
          horizon: 'H_SWING',
          targetHint: g4Location.nearestSupport.low - 1.0,
          invalidationHint: currentPrice + 2.0,
          leadingEvidence: [
            `Giá ép sát hỗ trợ ${g4Location.nearestSupport.low}–${g4Location.nearestSupport.high} (cách ${g4Location.distToSupport.toFixed(1)}đ)`,
            'Đỉnh cấu trúc hạ dần (Lower Highs)',
            'Biên độ dao động co thắt (Volatility Compression)',
          ],
          counterEvidence: [],
          rawScore: 78,
          stage: 'EARLY_FORECAST',
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // P03/P04: Slow reversal / deceleration (62 -> 50)
    // ─────────────────────────────────────────────────────────────
    if (g3Dynamics.isDecelerating) {
      if (g1Structure.trend === 'UPTREND' || (g4Location.nearestResistance && g4Location.distToResistance <= 1.5)) {
        candidates.push({
          setupId: 'P03_SLOW_REVERSAL_TOP',
          name: 'Đảo chiều chậm vùng đỉnh (Động lượng tăng suy yếu)',
          direction: 'DOWN',
          horizon: 'H_PATH', // 15m
          targetHint: g4Location.nearestSupport ? g4Location.nearestSupport.high : currentPrice - 4.0,
          invalidationHint: (g1Structure.swingHigh || currentPrice) + 1.2,
          leadingEvidence: [
            'Động lượng tăng suy yếu rõ rệt tại vùng giá cao',
            'Nỗ lực mua không mở rộng được đỉnh mới',
            'Các nhịp hồi sau suy giảm biên độ',
          ],
          counterEvidence: [],
          rawScore: 76,
          stage: 'EARLY_FORECAST',
        });
      } else if (g1Structure.trend === 'DOWNTREND' || (g4Location.nearestSupport && g4Location.distToSupport <= 1.5)) {
        candidates.push({
          setupId: 'P04_SLOW_REVERSAL_BOTTOM',
          name: 'Đảo chiều chậm vùng đáy (Động lượng giảm suy yếu)',
          direction: 'UP',
          horizon: 'H_PATH',
          targetHint: g4Location.nearestResistance ? g4Location.nearestResistance.low : currentPrice + 4.0,
          invalidationHint: (g1Structure.swingLow || currentPrice) - 1.2,
          leadingEvidence: [
            'Động lượng giảm suy yếu rõ rệt tại vùng giá thấp',
            'Lực bán không tạo được đáy mới sâu hơn',
            'Nhịp hồi nhỏ bắt đầu giữ được nền giá',
          ],
          counterEvidence: [],
          rawScore: 76,
          stage: 'EARLY_FORECAST',
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // P05/P06: Exhaustion at zone + early rebound (cung/cầu kiệt)
    // ─────────────────────────────────────────────────────────────
    if (g2Pressure.effortResultState === 'SUPPLY_EXHAUSTION_CANDIDATE' && g4Location.nearestSupport) {
      candidates.push({
        setupId: 'P05_SUPPLY_EXHAUSTION_REBOUND',
        name: 'Kiệt bán quanh hỗ trợ (Bật hồi sớm)',
        direction: 'UP',
        horizon: 'H_MICRO', // 3m
        targetHint: currentPrice + 2.5,
        invalidationHint: g4Location.nearestSupport.low - 0.8,
        leadingEvidence: [
          `Kiệt cung bán tại vùng hỗ trợ ${g4Location.nearestSupport.low}–${g4Location.nearestSupport.high}`,
          'Volume bán cạn kiệt, không tạo thêm độ trượt giá',
          'Lợi thế của phe Short suy giảm nghiêm trọng',
        ],
        counterEvidence: [],
        rawScore: 74,
        stage: 'EARLY_FORECAST',
      });
    }

    if (g2Pressure.effortResultState === 'DEMAND_EXHAUSTION_CANDIDATE' && g4Location.nearestResistance) {
      candidates.push({
        setupId: 'P06_DEMAND_EXHAUSTION_REBOUND',
        name: 'Kiệt cầu quanh kháng cự (Quay đầu sớm)',
        direction: 'DOWN',
        horizon: 'H_MICRO',
        targetHint: currentPrice - 2.5,
        invalidationHint: g4Location.nearestResistance.high + 0.8,
        leadingEvidence: [
          `Kiệt lực cầu tại vùng kháng cự ${g4Location.nearestResistance.low}–${g4Location.nearestResistance.high}`,
          'Volume mua cạn kiệt khi áp sát cản',
          'Lợi thế của phe Long suy giảm nghiêm trọng',
        ],
        counterEvidence: [],
        rawScore: 74,
        stage: 'EARLY_FORECAST',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // P07/P08: Trend pullback ending
    // ─────────────────────────────────────────────────────────────
    if (g1Structure.trend === 'UPTREND' && g1Structure.pullbackBars >= 2 && g2Pressure.pressureSide === 'BUY') {
      candidates.push({
        setupId: 'P07_PULLBACK_RESUMPTION_LONG',
        name: 'Nhịp chỉnh kết thúc (Tiếp diễn Uptrend)',
        direction: 'UP',
        horizon: 'H_SWING',
        targetHint: (g1Structure.swingHigh || currentPrice + 3.0),
        invalidationHint: currentPrice - 2.2,
        leadingEvidence: [
          'Xu hướng chủ đạo Uptrend duy trì',
          `Nhịp chỉnh ${g1Structure.pullbackBars} nến thoái lui giữ được hỗ trợ`,
          'Áp lực mua chủ động quay trở lại',
        ],
        counterEvidence: [],
        rawScore: 75,
        stage: 'EARLY_FORECAST',
      });
    }

    if (g1Structure.trend === 'DOWNTREND' && g1Structure.pullbackBars >= 2 && g2Pressure.pressureSide === 'SELL') {
      candidates.push({
        setupId: 'P08_PULLBACK_RESUMPTION_SHORT',
        name: 'Nhịp hồi kết thúc (Tiếp diễn Downtrend)',
        direction: 'DOWN',
        horizon: 'H_SWING',
        targetHint: (g1Structure.swingLow || currentPrice - 3.0),
        invalidationHint: currentPrice + 2.2,
        leadingEvidence: [
          'Xu hướng chủ đạo Downtrend duy trì',
          `Nhịp hồi ${g1Structure.pullbackBars} nến bị chặn dưới cản kỹ thuật`,
          'Áp lực bán chủ động đè trở lại',
        ],
        counterEvidence: [],
        rawScore: 75,
        stage: 'EARLY_FORECAST',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // P09/P10: Low supply rally / Low demand decline (30 -> 40)
    // ─────────────────────────────────────────────────────────────
    if (g2Pressure.effortResultState === 'LOW_VOLUME_RALLY') {
      candidates.push({
        setupId: 'P09_LOW_SUPPLY_RALLY',
        name: 'Tăng do thiếu cung (Low Volume Rally)',
        direction: 'UP',
        horizon: 'H_SWING',
        targetHint: g4Location.nearestResistance ? g4Location.nearestResistance.low : currentPrice + 3.0,
        invalidationHint: currentPrice - 1.8,
        leadingEvidence: [
          'Giá leo đều đặn dù volume thấp (thiếu cung bán chặn)',
          'Cấu trúc đáy nâng dần, các nhịp chỉnh nông',
          'Chưa có tín hiệu đảo chiều (không được mặc định short bắt đỉnh)',
        ],
        counterEvidence: ['Thanh khoản thấp, cẩn trọng khi chạm cản lớn'],
        rawScore: 72,
        stage: 'EARLY_FORECAST',
      });
    }

    if (g2Pressure.effortResultState === 'LOW_VOLUME_DECLINE') {
      candidates.push({
        setupId: 'P10_LOW_DEMAND_DECLINE',
        name: 'Giảm do thiếu cầu (Low Volume Decline)',
        direction: 'DOWN',
        horizon: 'H_SWING',
        targetHint: g4Location.nearestSupport ? g4Location.nearestSupport.high : currentPrice - 3.0,
        invalidationHint: currentPrice + 1.8,
        leadingEvidence: [
          'Giá trôi đều xuống do phe mua vắng bóng (thiếu cầu)',
          'Cấu trúc đỉnh thấp dần, nhịp hồi yếu ớt',
          'Chưa có tín hiệu rút chân đỡ giá (không được bắt đáy sớm)',
        ],
        counterEvidence: ['Thanh khoản thấp, cẩn trọng khi chạm hỗ trợ lớn'],
        rawScore: 72,
        stage: 'EARLY_FORECAST',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // P11/P12: Basis divergence / F1 lead
    // ─────────────────────────────────────────────────────────────
    if (g5CrossMarket.isBasisValid && g5CrossMarket.basisDivergence !== 'NONE') {
      if (g5CrossMarket.basisDivergence === 'F1_LEAD_BULLISH' && g2Pressure.pressureSide !== 'SELL') {
        candidates.push({
          setupId: 'P11_BASIS_LEAD_BULLISH',
          name: 'Phân kỳ Basis F1 dẫn dắt tăng',
          direction: 'UP',
          horizon: 'H_MICRO',
          targetHint: currentPrice + 2.5,
          invalidationHint: currentPrice - 1.8,
          leadingEvidence: [
            `F1 tăng tốc mạnh hơn VN30 (Basis mở rộng ${g5CrossMarket.basis >= 0 ? '+' : ''}${g5CrossMarket.basis}đ)`,
            'Dòng tiền phái sinh chủ động kéo trước',
          ],
          counterEvidence: [],
          rawScore: 73,
          stage: 'EARLY_FORECAST',
        });
      } else if (g5CrossMarket.basisDivergence === 'F1_LEAD_BEARISH' && g2Pressure.pressureSide !== 'BUY') {
        candidates.push({
          setupId: 'P12_BASIS_LEAD_BEARISH',
          name: 'Phân kỳ Basis F1 dẫn dắt giảm',
          direction: 'DOWN',
          horizon: 'H_MICRO',
          targetHint: currentPrice - 2.5,
          invalidationHint: currentPrice + 1.8,
          leadingEvidence: [
            `F1 tụt dốc mạnh hơn VN30 (Basis co hẹp/âm ${g5CrossMarket.basis}đ)`,
            'Dòng tiền phái sinh chủ động xả trước',
          ],
          counterEvidence: [],
          rawScore: 73,
          stage: 'EARLY_FORECAST',
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // P13/P14: Pre-shock pressure
    // ─────────────────────────────────────────────────────────────
    if (g3Dynamics.shockState === 'PRE_SHOCK_PRESSURE') {
      const isUp = g3Dynamics.velocity15s > 0;
      candidates.push({
        setupId: isUp ? 'P13_PRE_SHOCK_UP' : 'P14_PRE_SHOCK_DOWN',
        name: isUp ? 'Tiền xung lực giật tăng tốc (Pre-Shock Up)' : 'Tiền áp lực tụt giá nhanh (Pre-Shock Down)',
        direction: isUp ? 'UP' : 'DOWN',
        horizon: 'H_MICRO',
        targetHint: isUp ? currentPrice + 3.5 : currentPrice - 3.5,
        invalidationHint: isUp ? currentPrice - 2.0 : currentPrice + 2.0,
        leadingEvidence: [
          `Gia tốc 15s tăng đột biến (${isUp ? '+' : ''}${g3Dynamics.velocity15s.toFixed(2)}đ/s)`,
          'Chênh lệch lệnh một chiều áp đảo',
        ],
        counterEvidence: ['Biến động lớn, rủi ro quét râu hai chiều'],
        rawScore: 82,
        stage: 'EARLY_FORECAST',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // P15/P16: Failed continuation / Trap preparation
    // ─────────────────────────────────────────────────────────────
    if (g2Pressure.absorptionState === 'BUY_ABSORPTION_CANDIDATE') {
      candidates.push({
        setupId: 'P15_FAILED_CONTINUATION_UP',
        name: 'Kéo vượt đỉnh thất bại (Chuẩn bị bẫy Bull Trap)',
        direction: 'DOWN',
        horizon: 'H_SWING',
        targetHint: currentPrice - 3.0,
        invalidationHint: currentPrice + 1.8,
        leadingEvidence: [
          'Nỗ lực mua vượt đỉnh không tạo ra bước giá tăng tương xứng',
          'Cung bán chặn đối ứng lớn xuất hiện',
        ],
        counterEvidence: [],
        rawScore: 74,
        stage: 'EARLY_FORECAST',
      });
    }

    if (g2Pressure.absorptionState === 'SELL_ABSORPTION_CANDIDATE') {
      candidates.push({
        setupId: 'P16_FAILED_CONTINUATION_DOWN',
        name: 'Đạp thủng đáy thất bại (Chuẩn bị bẫy Bear Trap / Spring)',
        direction: 'UP',
        horizon: 'H_SWING',
        targetHint: currentPrice + 3.0,
        invalidationHint: currentPrice - 1.8,
        leadingEvidence: [
          'Nỗ lực bán thủng đáy bị hấp thụ hoàn toàn quanh hỗ trợ',
          'Cầu gom chặn đối ứng xuất hiện',
        ],
        counterEvidence: [],
        rawScore: 74,
        stage: 'EARLY_FORECAST',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // P17: Range rotation
    // ─────────────────────────────────────────────────────────────
    if (g6Context.marketRegime === 'RANGE' && g4Location.nearestSupport && g4Location.nearestResistance) {
      if (Math.abs(currentPrice - g4Location.nearestSupport.low) <= 1.2 && g2Pressure.pressureSide !== 'SELL') {
        candidates.push({
          setupId: 'P17_RANGE_ROTATION_UP',
          name: 'Xoay tua biên hộp từ hỗ trợ lên cản',
          direction: 'UP',
          horizon: 'H_SWING',
          targetHint: g4Location.nearestResistance.low,
          invalidationHint: g4Location.nearestSupport.low - 1.2,
          leadingEvidence: [
            `Giá chạm biên dưới hộp hỗ trợ ${g4Location.nearestSupport.low}`,
            'Thị trường sideway biên hẹp, lực bán từ chối xuyên đáy',
          ],
          counterEvidence: [],
          rawScore: 70,
          stage: 'EARLY_FORECAST',
        });
      } else if (Math.abs(currentPrice - g4Location.nearestResistance.high) <= 1.2 && g2Pressure.pressureSide !== 'BUY') {
        candidates.push({
          setupId: 'P17_RANGE_ROTATION_DOWN',
          name: 'Xoay tua biên hộp từ cản xuống hỗ trợ',
          direction: 'DOWN',
          horizon: 'H_SWING',
          targetHint: g4Location.nearestSupport.high,
          invalidationHint: g4Location.nearestResistance.high + 1.2,
          leadingEvidence: [
            `Giá chạm biên trên hộp cản ${g4Location.nearestResistance.high}`,
            'Thị trường sideway biên hẹp, lực mua từ chối vượt đỉnh',
          ],
          counterEvidence: [],
          rawScore: 70,
          stage: 'EARLY_FORECAST',
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // P18: Open / Reopen displacement
    // ─────────────────────────────────────────────────────────────
    if (g6Context.sessionPhase === 'REOPEN' && g3Dynamics.velocity60s !== 0) {
      const isReopenUp = g3Dynamics.velocity60s > 0;
      candidates.push({
        setupId: 'P18_REOPEN_DISPLACEMENT',
        name: isReopenUp ? 'Biến động mở đầu phiên chiều tăng' : 'Biến động mở đầu phiên chiều giảm',
        direction: isReopenUp ? 'UP' : 'DOWN',
        horizon: 'H_SWING',
        targetHint: isReopenUp ? currentPrice + 3.0 : currentPrice - 3.0,
        invalidationHint: isReopenUp ? currentPrice - 2.0 : currentPrice + 2.0,
        leadingEvidence: [
          'Biến động xác lập vị thế đầu phiên chiều sau nghỉ trưa',
          `Dòng tiền tái hấp thụ hướng ${isReopenUp ? 'Long' : 'Short'} dứt khoát`,
        ],
        counterEvidence: ['Cần theo dõi thêm nến xác nhận do mới mở phiên chiều'],
        rawScore: 71,
        stage: 'EARLY_FORECAST',
      });
    }

    return candidates;
  }
}

module.exports = {
  PreMoveDetector,
};
