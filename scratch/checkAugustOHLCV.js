const df = require('../src/derivatives/dataFetcher');

(async () => {
  const ohlcv = await df.fetchOHLCV('VN30F1M', 'D', 60);
  console.log('Date       | Open   | High   | Low    | Close  | Gap     | Chg');
  console.log('-----------|--------|--------|--------|--------|---------|--------');
  for (let i = 0; i < ohlcv.t.length; i++) {
    const d = new Date(ohlcv.t[i] * 1000);
    const dStr = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
    const prevC = i > 0 ? ohlcv.c[i-1] : ohlcv.o[i];
    const chg = parseFloat((ohlcv.c[i] - prevC).toFixed(1));
    const gap = parseFloat((ohlcv.o[i] - prevC).toFixed(1));
    const gapStr = (gap > 0 ? '+' : '') + gap.toFixed(1);
    const chgStr = (chg > 0 ? '+' : '') + chg.toFixed(1);
    console.log(
      dStr.padEnd(10) + ' | ' +
      ohlcv.o[i].toFixed(1).padStart(6) + ' | ' +
      ohlcv.h[i].toFixed(1).padStart(6) + ' | ' +
      ohlcv.l[i].toFixed(1).padStart(6) + ' | ' +
      ohlcv.c[i].toFixed(1).padStart(6) + ' | ' +
      gapStr.padStart(7) + ' | ' +
      chgStr.padStart(7)
    );
  }
})();
