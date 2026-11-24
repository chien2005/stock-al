/**
 * Entrade Derivative API Client (Product App Entrade - cọc 5%)
 * Kết nối CHÍNH XÁC tới hệ thống sàn Entrade thật:
 *  - DEMO: https://services.entrade.com.vn/papertrade-entrade-api (Trừ trực tiếp vào 1 TỶ vốn Demo của App)
 *  - LIVE: https://services.entrade.com.vn/entrade-api (Đánh bằng tiền thật)
 */

const axios = require('axios');
const entradeConfig = require('./entradeConfig');

class EntradeClient {
  constructor(options = {}) {
    this.env = options.env || entradeConfig.environment;
    this.config = entradeConfig.endpoints[this.env] || entradeConfig.endpoints.DEMO;
    this.credentials = { ...entradeConfig.credentials, ...options };
    this.token = null;
    this.investorId = this.credentials.investorId || 1000072805;
    this.bankMarginPortfolioId = this.credentials.bankMarginPortfolioId || 34;
    this.isDemo = this.env === 'DEMO';
  }

  /**
   * Đăng nhập lấy JWT Bearer Token chính thức từ Entrade
   */
  async login() {
    const username = this.credentials.username;
    const password = this.credentials.password;

    console.log(`[Entrade ${this.env}] Đang đăng nhập tài khoản Entrade: ${username}...`);
    try {
      const res = await axios.post(entradeConfig.endpoints.authUrl, {
        username: username,
        password: password
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (res.data && res.data.token) {
        this.token = res.data.token;
        console.log(`[Entrade ${this.env}] ✅ Đăng nhập thành công! Token đã được cấp.`);
        await this.syncMarginPortfolio();
        return { success: true, token: this.token };
      }
      throw new Error(res.data?.message || 'Login returned no token');
    } catch (error) {
      console.error(`[Entrade ${this.env}] ❌ Lỗi đăng nhập:`, error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Tự động đồng bộ gói ký quỹ mà người dùng đã chọn trên App Entrade
   */
  async syncMarginPortfolio() {
    try {
      const url = this.config.marginUrl(this.investorId);
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.data?.data && res.data.data.length > 0) {
        const activePkg = res.data.data[0];
        this.bankMarginPortfolioId = activePkg.id;
        this.activeMarginPackage = activePkg;
        const p0 = activePkg.portfolio?.[0] || {};
        const initPct = ((p0.initialRate || 0.1848) * 100).toFixed(2);
        const maintPct = ((p0.maintenanceRate || 0.1771) * 100).toFixed(2);
        const liqPct = ((p0.liquidateRate || 0.1735) * 100).toFixed(2);
        console.log(`[Entrade] Đồng bộ gói ký quỹ từ App: ${activePkg.name} (ID: ${activePkg.id}) | Cọc ban đầu: ${initPct}% | Gọi ký quỹ (Call Margin): ${maintPct}% | Cắt lỗ xử lý: ${liqPct}%`);
        return activePkg;
      }
      return null;
    } catch (e) {
      console.warn('[Entrade] Không thể đồng bộ gói margin:', e.message);
      return null;
    }
  }

  /**
   * Lấy số dư và tài sản thực tế từ hệ thống sàn Entrade (Demo hoặc Live)
   */
  async getAccountBalance() {
    if (!this.token) await this.login();

    try {
      const url = this.config.accountUrl(this.investorId);
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': 'Mozilla/5.0'
        }
      });

      const data = res.data || {};
      const totalCash = data.totalCash !== undefined ? data.totalCash : 1000000000;
      
      return {
        success: true,
        investorAccountId: data.id,
        investorId: data.investorId,
        totalCash: totalCash,
        availableCash: totalCash - (data.orderSecure || 0),
        orderSecure: data.orderSecure || 0,
        derivativeDealSecure: data.derivativeDealSecure || 0,
        raw: data
      };
    } catch (error) {
      console.error(`[Entrade] Lỗi lấy số dư tài khoản:`, error.response?.data || error.message);
      return {
        success: false,
        totalCash: 1000000000,
        availableCash: 1000000000
      };
    }
  }

  /**
   * Lấy danh sách lệnh trên sàn Entrade
   */
  async getOrders() {
    if (!this.token) await this.login();

    try {
      const url = `${this.config.ordersUrl}?investorId=${this.investorId}`;
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': 'Mozilla/5.0'
        }
      });
      return res.data?.data || [];
    } catch (error) {
      console.error(`[Entrade] Lỗi lấy sổ lệnh:`, error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Đặt lệnh Mở / Đóng vị thế trực tiếp lên hệ thống Entrade (Trừ thẳng vào tài khoản của bạn)
   * @param {object} order - { symbol: 'VN30F1M', side: 'LONG'|'SHORT', price: number, quantity: number, orderType: 'LO'|'MTL' }
   */
  async placeOrder(order) {
    if (!this.token) await this.login();

    const symbol = order.symbol || 'VN30F1M';
    const side = order.side.toUpperCase() === 'LONG' ? 'NB' : 'NS'; // NB: Mua/Long, NS: Bán/Short
    const qty = order.quantity || 1;
    const price = order.price;
    const orderType = order.orderType || 'LO';

    console.log(`[Entrade ${this.env}] 🚀 Gửi lệnh trực tiếp lên sàn: ${side} ${qty} HĐ ${symbol} @ ${price} (${orderType})`);

    const payload = {
      bankMarginPortfolioId: this.bankMarginPortfolioId,
      investorId: this.investorId,
      symbol: symbol,
      price: price,
      orderType: orderType,
      side: side,
      quantity: qty
    };

    try {
      const res = await axios.post(this.config.ordersUrl, payload, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        }
      });

      console.log(`[Entrade ${this.env}] ✅ Lệnh đã được sàn tiếp nhận thành công!`);
      return { success: true, order: res.data };
    } catch (error) {
      const errData = error.response?.data;
      console.error(`[Entrade ${this.env}] ⚠️ Phản hồi từ sàn:`, errData || error.message);
      return { 
        success: false, 
        error: errData?.message || error.message,
        detail: errData
      };
    }
  }
}

module.exports = EntradeClient;
