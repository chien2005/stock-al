/**
 * Quick check: Verify OI data from VPS API for recent sessions
 * So sánh với oi_history.json xem có sai lệch không
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const VPS_HISTORY_URL = 'https://histdatafeed.vps.com.vn/tradingview/history';
const VPS_PS_SNAPSHOT = 'https://bgapidatafeed.vps.com.vn/getpsalldatalsnapshot';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

async function main() {
  console.log('═'.repeat(80));
  console.log('🔍 VERIFY OI DATA: So sánh VPS API vs oi_history.json');
  console.log('═'.repeat(80));

  // 1. Lấy snapshot hiện tại
  console.log('\n📡 1. Snapshot VPS hiện tại:');
  try {
    const res = await axios.get(`${VPS_PS_SNAPSHOT}/41I1G9000,41I1GA000,41I1GC000,41I1H3000`, {
      headers: HEADERS, timeout: 8000,
    });
    const contracts = res.data || [];
    let totalOI = 0;
    contracts.forEach(c => {
      const oi = parseInt(c.oi || '0');
      const oichange = parseInt(c.oichange || '0');
      const sym = c.sym;
      const chartCode = sym === '41I1G9000' ? 'F1M' : sym === '41I1GA000' ? 'F2M' : sym === '41I1GC000' ? 'F1Q' : 'F2Q';
      totalOI += oi;
      console.log(`   ${chartCode} (${sym}): OI=${oi}, ΔOI=${oichange}, Price=${c.lastPrice}, Close=${c.closePrice}, Mature=${c.matureDate}`);
    });
    console.log(`   ➜ Tổng OI hiện tại (tất cả kỳ hạn): ${totalOI}`);
    
    // Chỉ F1M
    const f1m = contracts.find(c => c.sym === '41I1G9000');
    if (f1m) {
      console.log(`   ➜ F1M OI riêng: ${f1m.oi} (close=${f1m.closePrice}, last=${f1m.lastPrice})`);
    }
  } catch (e) {
    console.error('   ❌ Snapshot error:', e.message);
  }

  // 2. Lấy OI lịch sử từ VPS history (daily candles cho VN30F1M)
  console.log('\n📡 2. OI lịch sử VPS (daily bars gần nhất):');
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400 * 20;
    
    // Thử lấy data cho từng symbol thực tế
    const symbols = ['VN30F2609', 'VN30F1M'];
    
    for (const sym of symbols) {
      try {
        const res = await axios.get(
          `${VPS_HISTORY_URL}?symbol=${sym}&resolution=D&from=${from}&to=${now}`,
          { headers: HEADERS, timeout: 8000 }
        );
        if (res.data && res.data.c && res.data.c.length > 0) {
          const d = res.data;
          console.log(`\n   📊 ${sym}: ${d.c.length} daily bars`);
          // Show last 7 bars
          const startIdx = Math.max(0, d.c.length - 7);
          for (let i = startIdx; i < d.c.length; i++) {
            const ts = d.t[i] * 1000;
            const date = new Date(ts);
            const dateStr = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
            const dayOfWeek = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()];
            console.log(`   ${dateStr} (${dayOfWeek}): O=${d.o[i]} H=${d.h[i]} L=${d.l[i]} C=${d.c[i]} V=${d.v[i]}`);
          }
        }
      } catch (e) { /* skip */ }
    }
  } catch (e) {
    console.error('   ❌ History error:', e.message);
  }

  // 3. So sánh với file data
  console.log('\n📁 3. Data trong oi_history.json:');
  const oiHistory = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'oi_history.json'), 'utf8'));
  oiHistory.history.slice(-5).forEach(h => {
    console.log(`   ${h.date}: totalOI=${h.totalOI}, ΔOI=${h.oiChange}, F1M=${h.f1mPrice}, VN30=${h.vn30Price}`);
  });

  // 4. Check foreign_oi.json
  console.log('\n📁 4. Data trong foreign_oi.json:');
  const foreignOI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'foreign_oi.json'), 'utf8'));
  foreignOI.history.slice(-5).forEach(h => {
    console.log(`   ${h.date}: Buy=${h.buy}, Sell=${h.sell}, Net=${h.overnightNet}, TD=${h.tuDoanhOvernight}`);
  });

  console.log('\n' + '═'.repeat(80));
}

main().catch(e => console.error('Fatal:', e));
