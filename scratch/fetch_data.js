const { fetchAllStocks } = require('../src/stockService');

async function main() {
  try {
    const stocks = await fetchAllStocks();
    console.log("=== STOCK DATA SUMMARY ===");
    for (const s of stocks) {
      console.log(`Mã: ${s.symbol} | Giá: ${s.price} (Thay đổi: ${s.change} / ${s.changePct}%) | Khối lượng: ${s.volume} | NN mua ròng: ${s.foreignNetValue / 1e9} tỷ | BuyPressure: ${s.buyPressure}% | RSI: ${s.rsi || 'N/A'} | MACD: ${s.macdTrend || 'N/A'} | Signals: ${JSON.stringify(s.signals || {})}`);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
