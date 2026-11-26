/**
 * AI STOCK HUNTER - Configuration v2.1
 * Nâng cấp V2.1:
 * - Quét chart 15m toàn bộ 131 mã (lịch sử 45 ngày)
 * - Lịch sử nến ngày 850 ngày (đủ dữ liệu Tuần/Tháng dài hạn)
 * - RVOL cùng giờ yêu cầu tối thiểu 15 phiên cùng khung giờ
 * - Khóa BUY khi độ phủ dữ liệu < minUniverseCoverage
 * - Lưu trạng thái SL đã bị xuyên (persistent stop-breach) & cập nhật NAV đỉnh
 */

const STOCK_HUNTER_CONFIG = {
  schemaVersion: '2.1',
  ruleVersion: '2.1.0',
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
    dailyLookbackDays: 850,        // V2.1: 850 ngày cho nến D/W/M
    intraday15mLookbackDays: 45,   // V2.1: 45 ngày cho nến 15m
    scanAll15mUniverse: true,      // V2.1: Quét 15m toàn bộ 131 mã
    holidays: [
      '2026-01-01',
      '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
      '2026-04-26', '2026-04-27', '2026-04-30', '2026-05-01',
      '2026-09-02',
    ],
  },

  universe: {
    version: 'seed-2026.11-v2.1',
    targetMin: 100,
    targetMax: 150,
    supportedExchanges: ['HOSE', 'HNX'],
    minPriceVnd: 5000,
    minMedianMatchedValue20dVnd: 20_000_000_000, // 20 tỷ VND/phiên
    minMarketCapVnd: 3_000_000_000_000,        // 3,000 tỷ VND
    minQualityScore: 65,
    minQualityCoverage: 0.80,
    requireVerifiedQualityProfile: false, // Bật true nếu chỉ cho phép mã đã thẩm định BCTC chi tiết
    minDailyBars: 60,
    idealDailyBars: 250,
    minWeeklyBars: 40,
  },

  risk: {
    initialNavVnd: parseInt(process.env.SH_INITIAL_NAV || '60000000', 10),
    marginEnabled: false,
    lotSize: 100,
    maxPositions: 4,
    maxSymbolExposure: 0.35,
    maxClusterExposure: 0.40,
    riskPerTrade: 0.005,
    reversalRiskPerTrade: 0.0025,
    maxPlannedOpenRisk: 0.02,
    maxStressedLoss: 0.04,
    maxInitialStopPct: 0.04,
    minInitialStopPct: 0.015,
    tPlus2StressShockPct: 0.14,
    dailyLossGuard: 0.02,
    weeklyLossGuard: 0.04,
    drawdownReview: 0.05,
    drawdownKill: 0.08,
    maxHoldSessions: 19,
    maxHoldCalendarDays: 29,
    noAveragingDown: true,
    neverLowerStop: true,
    requireAvailableQuantityToExit: true,
    buyFeeRate: parseFloat(process.env.SH_BUY_FEE || '0.0015'),
    sellFeeRate: parseFloat(process.env.SH_SELL_FEE || '0.0015'),
    sellTaxRate: 0.001,
    exitSlippageBuffer: 0.0015,
  },

  strategies: {
    buyScoreMin: 70,
    minCriteriaPct: 70,
    watchScoreMin: 60,
    reversalScoreMin: 80,
    minRrNet: 1.5,
    reversalMinRrNet: 2.0,
    minRoomPct: 0.03,
    maxEntryChaseAtr: 0.5,
    maxSingleDayGainChase: 5.5,
    reversalLiveEnabled: process.env.SH_ENABLE_REVERSAL_LIVE === 'true',
    gapLiveEnabled: false,
    signalTtlMinutes: 30,
  },

  features: {
    maPeriods: [20, 50],
    atrPeriod: 14,
    rsiPeriod: 14,
    rvolHistorySessions: 20,
    minRvolHistory: 15,
    minSameSlot15mSessions: 15, // V2.1: Tối thiểu 15 phiên cùng khung giờ cho RVOL15
    pivotLeftBars: 2,
    pivotRightBars: 2,
    zoneClusterAtrFactor: 0.3,
  },

  notifications: {
    topBuy: 10,
    topWatch: 10,
    topSpecialWatch: 10,
    topAvoid: 10,
    alertReminderMinutes: 15,
    buyDuplicateCooldownMinutes: 60,
  },
};

module.exports = { STOCK_HUNTER_CONFIG };
