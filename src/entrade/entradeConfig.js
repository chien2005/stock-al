/**
 * Entrade Configuration (Product App Entrade - cọc 5%)
 * Kết nối CHÍNH XÁC tới hệ thống Entrade API thật:
 *  - Môi trường DEMO: https://services.entrade.com.vn/papertrade-entrade-api (Trừ thẳng vào 1 TỶ vốn Demo của App)
 *  - Môi trường LIVE: https://services.entrade.com.vn/entrade-api (Đánh bằng tiền thật)
 */

require('dotenv').config();

const entradeConfig = {
  // Môi trường: 'DEMO' (Khuyên dùng trước) hoặc 'LIVE'
  environment: process.env.ENTRADE_ENV || 'DEMO',

  // API Endpoints chính thức của Entrade App
  endpoints: {
    authUrl: 'https://services.entrade.com.vn/entrade-api/v2/auth',
    
    // Tách biệt hoàn toàn giữa Demo (PaperTrade) và Real (Live)
    DEMO: {
      baseUrl: 'https://services.entrade.com.vn/papertrade-entrade-api',
      ordersUrl: 'https://services.entrade.com.vn/papertrade-entrade-api/derivative/orders',
      accountUrl: (investorId) => `https://services.entrade.com.vn/papertrade-entrade-api/investors/${investorId}/investor_account`,
      balanceUrl: (investorId) => `https://services.entrade.com.vn/papertrade-entrade-api/account_balances/${investorId}`,
      marginUrl: (investorId) => `https://services.entrade.com.vn/papertrade-entrade-api/investors/${investorId}/derivative_margin_portfolios`,
    },
    LIVE: {
      baseUrl: 'https://services.entrade.com.vn/entrade-api',
      ordersUrl: 'https://services.entrade.com.vn/entrade-api/derivative/orders',
      accountUrl: (investorId) => `https://services.entrade.com.vn/entrade-api/investors/${investorId}/investor_account`,
      balanceUrl: (investorId) => `https://services.entrade.com.vn/entrade-api/account_balances/${investorId}`,
      marginUrl: (investorId) => `https://services.entrade.com.vn/entrade-api/investors/${investorId}/derivative_margin_portfolios`,
    }
  },

  // Thông tin định danh tài khoản Entrade
  credentials: {
    username: process.env.ENTRADE_USERNAME || '',
    password: process.env.ENTRADE_PASSWORD || '',
    investorId: process.env.ENTRADE_INVESTOR_ID ? parseInt(process.env.ENTRADE_INVESTOR_ID) : 1000072805,
    investorAccountIdDemo: 1000076317,
    investorAccountIdLive: 1000069866,
    bankMarginPortfolioId: 34, // Gói ký quỹ phái sinh Entrade
    ownerName: 'Phạm Đức Chiến',
    chatIdTradingDemo: '-5509642518',
  },

  // Quy tắc Quản trị rủi ro & Khóa Lợi Nhuận Thép (Profit Lock Guard)
  riskRules: {
    marginPerContract: 35000000, // Ký quỹ thực tế tỷ lệ 18.48% (~30-40 triệu / 1 HĐ VN30F)
    initialRate: 0.1848,        // Tỷ lệ ký quỹ ban đầu 18.48% (Gói 34 Entrade)
    maintenanceRate: 0.1771,    // Tỷ lệ duy trì 17.71%
    liquidateRate: 0.1735,      // Tỷ lệ giải chấp 17.35%
    tradingFeeRate: 12850,      // Phí giao dịch sàn 12.850 đ/HĐ
    taxFeePerContract: 0.6,     // Thuế phí 2 chiều ước tính ~0.6đ/hợp đồng
    lockTriggerPoint: 1.0,      // Khi lãi chạm +1.0đ
    lockGuaranteedProfit: 0.6,  // Chặn SL ngay lập tức ở mức tối thiểu +0.6đ (Bảo vệ lãi ròng)
    
    // Các nấc dời SL tiếp theo
    step1_profit: 1.5,
    step1_lock: 1.0,
    
    step2_profit: 2.0,
    step2_lock: 1.4,
    
    step3_profit: 3.0,
    step3_lock: 2.2,
    
    trailingDistance: 1.2,      // Khi lãi > 4.0đ, duy trì trailing khoảng cách tối thiểu 1.2đ
    maxInitialSL: 1.5,          // Stoploss ban đầu tối đa 1.5đ từ điểm vào lệnh
  },

  strategyRules: {
    srLookbackDays: 1,
    basisWeight: 0.08,
    fibonacciLevels: [0.382, 0.500, 0.618, 0.786],
    rsiOverbought: 75,
    rsiOversold: 25,
  }
};

module.exports = entradeConfig;
