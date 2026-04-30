/**
 * Test: Predictive Engine + Enhanced Stock Data
 * Kiểm tra tính toán Technical Indicators + Prediction Scores
 */

require('dotenv').config();

async function testPredictive() {
  console.log('═'.repeat(55));
  console.log('🔮 TEST: Predictive Engine');
  console.log('═'.repeat(55));

  const { fetchAllStocks } = require('./stockService');
  const { calculateAllIndicators, calcShortTermScore, calcMidTermScore, getScoreEmoji, formatIndicatorsForAI } = require('./predictiveEngine');

  try {
    // 1. Fetch stocks (includes historyData)
    const stocks = await fetchAllStocks();
    const validStocks = stocks.filter(s => !s.error && s.historyData);

    console.log(`\n📊 ${validStocks.length}/${stocks.length} mã có đủ dữ liệu lịch sử\n`);

    // 2. Tính indicators cho từng mã
    for (const stock of validStocks) {
      const indicators = calculateAllIndicators(stock.historyData, stock.price);
      
      if (indicators.error) {
        console.log(`❌ ${stock.symbol}: ${indicators.error}`);
        continue;
      }

      const shortScore = calcShortTermScore(indicators, stock);
      const midScore = calcMidTermScore(indicators, stock);

      console.log(`\n${'─'.repeat(50)}`);
      console.log(`${getScoreEmoji(shortScore.score)} ${stock.symbol}: ${stock.price.toLocaleString('vi-VN')}đ (${stock.changePct >= 0 ? '+' : ''}${stock.changePct}%)`);
      console.log(`   📈 RSI(14): ${indicators.rsi14 || 'N/A'}`);
      console.log(`   📊 MACD: ${indicators.macd ? indicators.macd.trend : 'N/A'} (H: ${indicators.macd?.histogram || 'N/A'})`);
      
      if (indicators.bollingerBands) {
        const bb = indicators.bollingerBands;
        console.log(`   🎯 Bollinger: [${bb.lower} - ${bb.upper}] %B=${bb.percentB.toFixed(2)}`);
      }
      
      if (indicators.smaCross) {
        console.log(`   🔄 SMA Cross: ${indicators.smaCross.signal} (SMA5=${indicators.smaCross.sma5} SMA20=${indicators.smaCross.sma20})`);
      }
      
      console.log(`   📈 ROC(5): ${indicators.roc5 || 'N/A'}% | ROC(10): ${indicators.roc10 || 'N/A'}%`);
      
      if (indicators.volumeTrend) {
        console.log(`   📦 Vol Trend: ${indicators.volumeTrend.trend} (${indicators.volumeTrend.ratio}x)`);
      }
      
      if (indicators.supportResistance) {
        const sr = indicators.supportResistance;
        console.log(`   🏗️ Support: ${sr.support20} | Resistance: ${sr.resistance20}`);
      }

      // Scores
      console.log(`   🎯 SHORT-TERM: ${shortScore.score}/100 ${getScoreEmoji(shortScore.score)} (${shortScore.label})`);
      console.log(`      Tech=${shortScore.breakdown.technical} | Money=${shortScore.breakdown.moneyFlow} | Mom=${shortScore.breakdown.momentum} | Vol=${shortScore.breakdown.volume}`);
      console.log(`   📅 MID-TERM:   ${midScore.score}/100 ${getScoreEmoji(midScore.score)} (${midScore.label})`);
      console.log(`      Trend=${midScore.breakdown.trend} | Flow=${midScore.breakdown.institutionalFlow} | Range=${midScore.breakdown.priceRange}`);
    }

    // 3. Summary ranking
    console.log(`\n${'═'.repeat(55)}`);
    console.log('🏆 RANKING (Short-term Score):\n');

    const ranked = validStocks
      .map(s => {
        const indicators = calculateAllIndicators(s.historyData, s.price);
        const shortScore = calcShortTermScore(indicators, s);
        const midScore = calcMidTermScore(indicators, s);
        return { symbol: s.symbol, short: shortScore, mid: midScore, changePct: s.changePct };
      })
      .sort((a, b) => b.short.score - a.short.score);

    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      console.log(`   ${medal} ${r.symbol}: SHORT=${r.short.score} ${getScoreEmoji(r.short.score)} | MID=${r.mid.score} ${getScoreEmoji(r.mid.score)} | Today: ${r.changePct >= 0 ? '+' : ''}${r.changePct}%`);
    }

  } catch (error) {
    console.error('💥 Error:', error);
  }
}

testPredictive();
