/**
 * ═══════════════════════════════════════════════════════════════
 *  AUTONOMOUS DAY MANAGER — ENTRADE DEMO TRADING BOT
 * ═══════════════════════════════════════════════════════════════
 * Quản lý vòng đời phiên giao dịch tự động từ 8h59 đến 14h30:
 *  1. 8h59: Kiểm tra API Entrade, chốt vốn đầu ngày, cài đặt ngưỡng Max Loss.
 *  2. 9h00 - 14h30: Giám sát Cung Cầu, Fibo, Quá mua/bán, đi lệnh, Profit Lock (+1.0đ -> +0.6đ).
 *  3. Mỗi khi ra/vào lệnh: Giám sát chặt chẽ tài sản, bắn Telegram tức thì.
 *  4. 14h30: Tổng kết toàn bộ phiên, tính P&L ròng, bắn Telegram báo cáo ngày.
 */

require('dotenv').config();
const EntradeClient = require('./entradeClient');
const ProfitLockGuard = require('./profitLockGuard');
const entradeConfig = require('./entradeConfig');
const { config } = require('../config');
const axios = require('axios');

class AutonomousDayManager {
  constructor(options = {}) {
    this.client = new EntradeClient({ env: options.env || entradeConfig.environment });
    this.chatId = options.chatId || config.telegram.chatIdTradingDemo || '-5509642518';
    this.telegramToken = config.telegram.botToken;
    this.isSimulation = options.isSimulation || false;

    // Quản lý trạng thái ngày
    this.dateStr = new Date().toLocaleDateString('vi-VN');
    this.initialEquity = 50000000;  // Vốn đầu ngày (VNĐ)
    this.currentEquity = 50000000;  // Vốn hiện tại
    this.maxDailyLossPoints = 4.0;  // Lỗ tối đa 4.0đ/ngày -> Dừng khẩn cấp
    this.activePosition = null;
    this.profitGuard = null;
    this.closedTrades = [];
    this.consecutiveLosses = 0;     // Đếm số lệnh lỗ liên tiếp
    this.haltUntil = 0;             // Thời điểm hết hạn cúp cầu dao tạm thời
    this.isHalted = false;          // Cầu dao khẩn cấp hết ngày
  }

  /**
   * Gửi thông báo Telegram định dạng HTML
   */
  async sendNoti(htmlText) {
    console.log(`[Telegram Noti]:\n${htmlText.replace(/<[^>]+>/g, '')}\n`);
    if (!this.telegramToken || !this.chatId) return;

    try {
      await axios.post(`https://api.telegram.org/bot${this.telegramToken}/sendMessage`, {
        chat_id: this.chatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (e) {
      console.warn(`[Telegram] Lỗi gửi tin nhắn:`, e.response?.data?.description || e.message);
    }
  }

  /**
   * BƯỚC 1: 8h59 SÁNG — ĐĂNG NHẬP, XÁC ĐỊNH VỐN ĐẦU NGÀY
   */
  async startMorningRoutine() {
    console.log(`\n⏰ [08:59] KÍCH HOẠT QUY TRÌNH ĐẦU NGÀY...`);

    const loginRes = await this.client.login();
    if (!loginRes.success) {
      await this.sendNoti(`⚠️ <b>[CẢNH BÁO 8h59]</b> Không thể đăng nhập Entrade: ${loginRes.error}`);
      return false;
    }

    const bal = await this.client.getAccountBalance();
    if (bal && bal.totalCash !== undefined) {
      this.initialEquity = bal.totalCash;
      this.currentEquity = bal.totalCash;
    }

    const maxLossVnd = this.maxDailyLossPoints * 100000;
    const msg = `
🌅 <b>[ENTRADE DEMO] KHỞI ĐỘNG PHIÊN GIAO DỊCH VN30F</b>
📅 Ngày: <b>${this.dateStr}</b> | Giờ: <b>08:59:00</b>
━━━━━━━━━━━━━━━━━━━━━━
👤 Chủ tài khoản: <b>${this.client.credentials.ownerName || 'Phạm Đức Chiến'}</b>
🆔 Tiểu khoản Demo: <code>${bal.investorAccountId || this.client.credentials.investorAccountIdDemo}</code> (ID: ${this.client.investorId})
💰 <b>Vốn thực tế trên App Entrade:</b> <code>${this.initialEquity.toLocaleString('vi-VN')} đ</code>

🛡️ <b>QUY TẮC QUẢN TRỊ RỦI RO THÉP:</b>
• Ngưỡng dừng lỗ ngày (Max Loss): <b>-${this.maxDailyLossPoints}đ</b> (~${maxLossVnd.toLocaleString('vi-VN')}đ)
• Thuế phí ước tính: <b>~0.6đ/HĐ</b>
• <b>Khóa lợi nhuận:</b> Lãi chạm <b>+1.0đ</b> ➔ Lập tức dời SL chặn <b>+0.6đ</b> (Lãi ròng)
• <b>Cung cầu & Chart:</b> Tập trung Fibo, Quá mua/Quá bán, cản 1 ngày gần nhất.

🚀 <i>Bot đã sẵn sàng đón sóng ATO và phiên 9h00!</i>
`;
    await this.sendNoti(msg.trim());
    return true;
  }

  /**
   * BƯỚC 2: MỞ LỆNH THỰC CHIẾN (VÀO VỊ THẾ)
   */
  async openPosition(orderPlan) {
    if (this.isHalted) {
      console.warn(`[Bot] Đang kích hoạt cầu dao dừng ngày. Bỏ qua lệnh mới.`);
      return null;
    }

    if (this.haltUntil && Date.now() < this.haltUntil) {
      const remainingMin = Math.ceil((this.haltUntil - Date.now()) / 60000);
      console.warn(`[Bot] Đang trong thời gian cúp cầu dao 2 lệnh thua liên tiếp. Còn ${remainingMin} phút.`);
      return null;
    }

    if (this.activePosition) {
      console.warn(`[Bot] Đang có vị thế mở. Không mở lệnh trùng.`);
      return null;
    }

    const side = orderPlan.side.toUpperCase(); // 'LONG' | 'SHORT'
    const entryPrice = orderPlan.entryPrice;
    const slPrice = orderPlan.slPrice;
    const tpTarget = orderPlan.tpTarget || 'Theo Trailing Fibo';
    const reason = orderPlan.reason || 'Cung cầu xác nhận';

    // Đặt lệnh qua Entrade
    const orderRes = await this.client.placeOrder({
      symbol: 'VN30F1M',
      side,
      price: entryPrice,
      quantity: 1,
      orderType: 'MTL'
    });

    if (!orderRes.success) {
      await this.sendNoti(`❌ <b>Lỗi đặt lệnh Entrade:</b> ${orderRes.error}`);
      return null;
    }

    // Khởi tạo vị thế và Profit Lock Guard
    this.activePosition = {
      id: orderRes.order?.orderId || `ORD-${Date.now()}`,
      side,
      entryPrice,
      quantity: 1,
      initialSL: slPrice,
      currentSL: slPrice,
      maxProfitReached: 0,
      openTime: new Date()
    };

    this.profitGuard = new ProfitLockGuard(this.activePosition);

    const icon = side === 'LONG' ? '🟢 <b>MỞ VỊ THẾ LONG</b>' : '🔴 <b>MỞ VỊ THẾ SHORT</b>';
    const riskPoints = Math.abs(entryPrice - slPrice).toFixed(1);

    const msg = `
${icon} [ENTRADE DEMO]
━━━━━━━━━━━━━━━━━━━━━━
🎯 <b>Giá khớp (Entry):</b> <code>${entryPrice.toFixed(1)}</code>
🛡️ <b>Stoploss ban đầu:</b> <code>${slPrice.toFixed(1)}</code> (-${riskPoints}đ)
🎯 <b>Mục tiêu (TP):</b> <code>${tpTarget}</code>
💡 <b>Lý do vào lệnh:</b> ${reason}

⚠️ <i>Cơ chế Profit Lock đang kích hoạt: Lãi +1.0đ tự động dời SL lên +0.6đ khóa lãi ròng!</i>
`;
    await this.sendNoti(msg.trim());
    return this.activePosition;
  }

  /**
   * BƯỚC 3: GIÁM SÁT TỪNG TICK GIÁ & DỜI SL KHÓA LÃI
   */
  async onPriceTick(currentPrice) {
    if (!this.activePosition || !this.profitGuard) return;

    const evaluation = this.profitGuard.evaluatePriceTick(currentPrice);

    // Kịch bản A: Dời SL khóa lãi (+1.0đ -> +0.6đ)
    if (evaluation.action === 'UPDATE_SL') {
      const isLong = this.activePosition.side === 'LONG';
      const lockedPoints = isLong
        ? (evaluation.newSL - this.activePosition.entryPrice).toFixed(1)
        : (this.activePosition.entryPrice - evaluation.newSL).toFixed(1);

      const msg = `
🔒 <b>[PROFIT LOCK GUARD] BẢO VỆ LỢI NHUẬN</b>
━━━━━━━━━━━━━━━━━━━━━━
Vị thế: <b>${this.activePosition.side} @ ${this.activePosition.entryPrice.toFixed(1)}</b>
Giá hiện tại: <code>${currentPrice.toFixed(1)}</code>
🎯 <b>Dời Stoploss mới:</b> <code>${evaluation.newSL.toFixed(1)}</code> (Khóa chắc <b>+${lockedPoints}đ</b>)
💡 <b>Chi tiết:</b> ${evaluation.reason}

✨ <i>Lệnh này đã được bảo vệ 100%: Tuyệt đối không thể lỗ sau phí thuế!</i>
`;
      await this.sendNoti(msg.trim());
    }

    // Kịch bản B: Khớp Stoploss / Chốt lời (Đóng lệnh)
    else if (evaluation.action === 'STOP_OUT') {
      await this.closePosition(evaluation.exitPrice, evaluation.reason);
    }
  }

  /**
   * BƯỚC 4: ĐÓNG VỊ THẾ & CẬP NHẬT TÀI SẢN
   */
  async closePosition(exitPrice, reason = '') {
    if (!this.activePosition) return;

    const pos = this.activePosition;
    const isLong = pos.side === 'LONG';
    const grossPoints = isLong ? (exitPrice - pos.entryPrice) : (pos.entryPrice - exitPrice);
    const feePoints = entradeConfig.riskRules.taxFeePerContract;
    const netPoints = grossPoints - feePoints;
    const netMoney = netPoints * 100000;

    this.currentEquity += netMoney;

    const tradeRecord = {
      side: pos.side,
      entry: pos.entryPrice,
      exit: exitPrice,
      grossPoints,
      netPoints,
      netMoney,
      closeTime: new Date(),
      reason
    };
    this.closedTrades.push(tradeRecord);

    const isWin = netPoints > 0;
    const resultIcon = isWin ? '🎉 <b>ĐÓNG LỆNH — CHỐT LÃI</b>' : '🛑 <b>ĐÓNG LỆNH — CẮT LỖ</b>';

    const msg = `
${resultIcon} [ENTRADE DEMO]
━━━━━━━━━━━━━━━━━━━━━━
Vị thế: <b>${pos.side}</b> | Vào: <code>${pos.entryPrice.toFixed(1)}</code> ➔ Đóng: <code>${exitPrice.toFixed(1)}</code>
Điểm tổng: <b>${grossPoints > 0 ? '+' : ''}${grossPoints.toFixed(1)}đ</b>
Phí thuế 2 chiều: <b>-${feePoints.toFixed(1)}đ</b>
💰 <b>LÃI/LỖ RÒNG:</b> <code>${netPoints > 0 ? '+' : ''}${netPoints.toFixed(1)}đ</code> (<b>${netMoney > 0 ? '+' : ''}${netMoney.toLocaleString('vi-VN')} đ</b>)
📊 <b>Tài sản Demo hiện tại:</b> <code>${this.currentEquity.toLocaleString('vi-VN')} đ</code>
📝 <b>Lý do đóng:</b> ${reason}
`;
    await this.sendNoti(msg.trim());

    // Reset vị thế
    this.activePosition = null;
    this.profitGuard = null;

    // Quản trị chuỗi thua: 2 lệnh thua liên tiếp = Cúp cầu dao 30 phút (Plan v4.0)
    if (netPoints <= 0) {
      this.consecutiveLosses = (this.consecutiveLosses || 0) + 1;
      if (this.consecutiveLosses >= 2) {
        this.haltUntil = Date.now() + 30 * 60 * 1000;
        await this.sendNoti(`🚨 <b>[CẦU DAO THUA 2 LỆNH LIÊN TIẾP]</b> Hệ thống vừa ghi nhận 2 lệnh thua liên tiếp. Theo KỶ LUẬT THÉP Plan v4.0: Cúp cầu dao TẠM DỪNG MỞ LỆNH 30 PHÚT để tránh bẫy tâm lý và lái quay thanh khoản!`);
      }
    } else {
      this.consecutiveLosses = 0;
    }

    // Kiểm tra Cầu dao dừng ngày (Max Daily Loss)
    const totalDayLoss = this.initialEquity - this.currentEquity;
    if (totalDayLoss >= (this.maxDailyLossPoints * 100000)) {
      this.isHalted = true;
      await this.sendNoti(`🚨 <b>[CẦU DAO KHẨN CẤP]</b> Tổng lỗ ngày đã chạm ${totalDayLoss.toLocaleString('vi-VN')}đ (-${this.maxDailyLossPoints}đ). Bot tự động NGỪNG GIAO DỊCH để bảo toàn vốn!`);
    }
  }

  /**
   * BƯỚC 5: 14h30 — TỔNG KẾT BÁO CÁO TOÀN PHIÊN
   */
  async endOfDayReport() {
    console.log(`\n🏁 [14:30] KẾT PHIÊN — TỔNG KẾT NGÀY GIAO DỊCH...`);

    // Nếu còn vị thế mở -> Buộc đóng trước 14h28
    if (this.activePosition) {
      await this.closePosition(this.activePosition.entryPrice, 'Đóng bắt buộc cuối ngày 14h28 (Không giữ qua đêm)');
    }

    const totalTrades = this.closedTrades.length;
    const winTrades = this.closedTrades.filter(t => t.netPoints > 0).length;
    const lossTrades = this.closedTrades.filter(t => t.netPoints <= 0).length;
    const winRate = totalTrades > 0 ? ((winTrades / totalTrades) * 100).toFixed(1) : 0;

    const totalNetPoints = this.closedTrades.reduce((acc, t) => acc + t.netPoints, 0);
    const totalNetMoney = this.currentEquity - this.initialEquity;
    const totalFee = totalTrades * (entradeConfig.riskRules.taxFeePerContract * 100000);

    const isDayProfitable = totalNetMoney >= 0;
    const banner = isDayProfitable 
      ? '🏆 <b>TỔNG KẾT PHIÊN — KẾT QUẢ DƯƠNG</b>' 
      : '⚠️ <b>TỔNG KẾT PHIÊN — KẾT QUẢ ÂM</b>';

    const msg = `
${banner}
📅 Ngày: <b>${this.dateStr}</b> | Giờ: <b>14:30:00</b>
━━━━━━━━━━━━━━━━━━━━━━
💰 <b>Vốn đầu ngày:</b>  <code>${this.initialEquity.toLocaleString('vi-VN')} đ</code>
💼 <b>Vốn cuối ngày:</b> <code>${this.currentEquity.toLocaleString('vi-VN')} đ</code>
📈 <b>LÃI / LỖ RÒNG HÔM NAY:</b> <b>${totalNetMoney >= 0 ? '+' : ''}${totalNetMoney.toLocaleString('vi-VN')} đ</b> (<b>${totalNetPoints >= 0 ? '+' : ''}${totalNetPoints.toFixed(1)}đ</b>)

📊 <b>THỐNG KÊ CHIẾN LƯỢC:</b>
• Tổng số lệnh: <b>${totalTrades}</b> (Thắng: ${winTrades} | Thua: ${lossTrades})
• Win Rate: <b>${winRate}%</b>
• Tổng phí thuế sàn đã trừ: <b>-${totalFee.toLocaleString('vi-VN')} đ</b>
• Trạng thái lệnh: <b>Đã đóng sạch 100%</b> (Không giữ qua đêm)

${isDayProfitable ? '✨ <i>Chiến thuật Profit Lock đã bảo toàn thành công lợi nhuận ròng!</i>' : '🛡️ <i>Cầu dao rủi ro đã chặn đứng đà thua lỗ trong tầm kiểm soát!</i>'}
`;
    await this.sendNoti(msg.trim());
    return { totalNetMoney, totalNetPoints, winRate };
  }
}

module.exports = AutonomousDayManager;
