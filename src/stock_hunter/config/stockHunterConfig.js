/**
 * AI STOCK HUNTER - Configuration v2.0
 * Toàn bộ tham số khởi tạo (Seed Config) tuân thủ Master Plan V2.0 Section 22.5.
 * Mọi tỷ lệ phần trăm dùng dạng số thập phân (fraction: 0.04 = 4%).
 */

const STOCK_HUNTER_CONFIG = {
  schemaVersion: '2.0',
  ruleVersion: '2.0.0',
  mode: (process.env.SH_MODE || 'paper').toLowerCase(), // 'research' | 'paper' | 'live_advisory'

  market: {
    timezone: process.env.TZ || 'Asia/Ho_Chi_Minh',
    scanIntervalMinutes: 15,
    reports: ['09:30', '11:30', '13:30', '14:00', '14:46'],
    finalBarOnly: true,
    minUniverseCoverage: 0.98,
    minMarketCoverage: 0.90,
    fastGuardianPollSeconds: 30,
    staleQuoteSeconds: 90,
    // Ngày nghỉ lễ TTCK VN (YYYY-MM-DD) - bổ sung hàng năm qua config/env
    holidays: [
      '2026-01-01',
      '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
      '2026-04-26', '2026-04-27', '2026-04-30', '2026-05-01',
      '2026-09-02',
    ],
  },

  universe: {
    version: 'seed-2026.11',
    targetMin: 100,
    targetMax: 150,
    supportedExchanges: ['HOSE', 'HNX'],
    minPriceVnd: 5000,
    minMedianMatchedValue20dVnd: 20_000_000_000, // 20 tỷ VND/phiên
    minMarketCapVnd: 3_000_000_000_000,        // 3,000 tỷ VND
    minQualityScore: 65,
    minQualityCoverage: 0.80,
    minDailyBars: 60,
    idealDailyBars: 120,
    minWeeklyBars: 20,
  },

  risk: {
    initialNavVnd: parseInt(process.env.SH_INITIAL_NAV || '60000000', 10), // 60 triệu VND
    marginEnabled: false,
    lotSize: 100,
    maxPositions: 4,
    maxSymbolExposure: 0.35,      // 35% NAV
    maxClusterExposure: 0.40,     // 40% NAV
    riskPerTrade: 0.005,          // 0.5% NAV
    reversalRiskPerTrade: 0.0025, // 0.25% NAV
    maxPlannedOpenRisk: 0.02,     // 2.0% NAV
    maxStressedLoss: 0.04,        // 4.0% NAV
    maxInitialStopPct: 0.04,      // 4.0% hard cap cho setup chuẩn (có thể cấu hình tối đa 4.5% nếu policy cho phép)
    minInitialStopPct: 0.015,     // Tránh stop quá chặt bị quét noise
    tPlus2StressShockPct: 0.14,   // Stress kịch bản 2 phiên xấu (~2 cây sàn HOSE) nếu cần kiểm định
    dailyLossGuard: 0.02,         // -2% NAV ngày -> khóa mua mới
    weeklyLossGuard: 0.04,        // -4% NAV tuần -> khóa mua mới
    drawdownReview: 0.05,         // -5% từ đỉnh NAV -> giảm quy mô
    drawdownKill: 0.08,           // -8% từ đỉnh NAV -> kill switch khóa entry
    maxHoldSessions: 19,          // < 1 tháng (19 phiên giao dịch)
    maxHoldCalendarDays: 29,
    noAveragingDown: true,
    neverLowerStop: true,
    requireAvailableQuantityToExit: true,
    // Chi phí giao dịch thực tế
    buyFeeRate: parseFloat(process.env.SH_BUY_FEE || '0.0015'),   // 0.15%
    sellFeeRate: parseFloat(process.env.SH_SELL_FEE || '0.0015'), // 0.15%
    sellTaxRate: 0.001,                                           // 0.10% thuế chuyển nhượng (Nghị định 253/2026)
    exitSlippageBuffer: 0.0015,                                   // 0.15% dự phòng trượt giá khi thoát
  },

  strategies: {
    buyScoreMin: 80,
    watchScoreMin: 65,
    reversalScoreMin: 85,
    minRrNet: 1.5,
    reversalMinRrNet: 2.0,
    minRoomPct: 0.03,           // Tối thiểu 3% tới vùng cung gần nhất
    maxEntryChaseAtr: 0.5,      // Không vào quá xa trigger > 0.5 ATR_D
    maxSingleDayGainChase: 5.5, // % tăng trong phiên quá +5.5% -> cấm mua đuổi
    reversalLiveEnabled: process.env.SH_ENABLE_REVERSAL_LIVE === 'true',
    gapLiveEnabled: false,
    signalTtlMinutes: 30,       // Tín hiệu 15m có hiệu lực tối đa 2 nến (30 phút)
  },

  features: {
    maPeriods: [20, 50],
    atrPeriod: 14,
    rsiPeriod: 14,
    rvolHistorySessions: 20,
    minRvolHistory: 15,
    pivotLeftBars: 2,
    pivotRightBars: 2,
    zoneClusterAtrFactor: 0.3,
  },

  notifications: {
    topBuy: 3,
    topWatch: 5,
    topSpecialWatch: 5,
    topAvoid: 5,
    alertReminderMinutes: 15,
    buyDuplicateCooldownMinutes: 60,
  },
};

module.exports = { STOCK_HUNTER_CONFIG };
