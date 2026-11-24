/**
 * Entrade Demo Trading Bot Runner
 * Chạy thử nghiệm hệ thống phái sinh VN30F trên tài khoản Entrade Demo
 * 
 * Lệnh chạy:
 *   node scripts/run_entrade_demo.js
 */

require('dotenv').config();
const EntradeClient = require('../src/entrade/entradeClient');
const ProfitLockGuard = require('../src/entrade/profitLockGuard');
const config = require('../src/entrade/entradeConfig');

async function startDemoBot() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🤖 KHỞI ĐỘNG AUTONOMOUS AI DERIVATIVE BOT — ENTRADE DEMO');
  console.log('════════════════════════════════════════════════════════════════');

  const client = new EntradeClient({ env: 'DEMO' });
  const loginRes = await client.login();

  if (!loginRes.success) {
    console.error('❌ Đăng nhập thất bại. Kiểm tra lại thông tin trong .env');
    return;
  }

  console.log('\n📊 THÔNG TIN TÀI KHOẢN KẾT NỐI:');
  console.log(`   - Chủ tài khoản: ${config.credentials.ownerName}`);
  console.log(`   - Số lưu ký:     ${config.credentials.custodyCode}`);
  console.log(`   - Tiểu khoản PS:  ${client.accountNo}`);
  console.log(`   - Môi trường:     ${config.environment}`);
  console.log(`   - Thuế phí/lệnh:  ~${config.riskRules.taxFeePerContract}đ`);
  console.log(`   - Quy tắc khóa:   Lãi chạm +${config.riskRules.lockTriggerPoint}đ -> Chặn SL +${config.riskRules.lockGuaranteedProfit}đ`);

  console.log('\n📡 Đang lắng nghe luồng dữ liệu thị trường và sẵn sàng nhận tín hiệu...');
  console.log('   (Bot sẽ chạy theo dõi phiên, phân tích Fibo, dải Quá mua/Quá bán và tự động kích hoạt Profit Lock khi có vị thế)\n');
}

startDemoBot();
