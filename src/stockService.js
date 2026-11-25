/**
 * Minimal shared VPS market data helper used by derivatives modules
 * (pillarMonitor.js & intradaySignalEngine.js).
 * Legacy equity scanning code has been removed and replaced by src/stock_hunter/.
 */

const axios = require('axios');

const VPS_REALTIME_URL = 'https://bgapidatafeed.vps.com.vn/getliststockdata';
const VPS_INDEX_DETAIL_URL = 'https://bgapidatafeed.vps.com.vn/getlistindexdetail/10,02,03';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

async function fetchRealtimeData(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return [];
  const url = `${VPS_REALTIME_URL}/${symbols.join(',')}`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });
      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data;
      }
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`⚠️ fetchRealtimeData failed: ${error.message}`);
      }
    }
    if (attempt < maxRetries) {
      await new Promise(res => setTimeout(res, 1000));
    }
  }
  return [];
}

async function fetchMarketLiquidity() {
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(VPS_INDEX_DETAIL_URL, { headers: HEADERS, timeout: 10000 });
      if (Array.isArray(response.data)) {
        let hoseVal = 0;
        let hnxVal = 0;
        let upcomVal = 0;

        for (const item of response.data) {
          const val = parseFloat(item.value || 0) / 1000; // tỷ VNĐ
          if (item.mc === '10') hoseVal = val;
          else if (item.mc === '02') hnxVal = val;
          else if (item.mc === '03') upcomVal = val;
        }

        return {
          hose: hoseVal,
          hnx: hnxVal,
          upcom: upcomVal,
          total: hoseVal + hnxVal + upcomVal,
        };
      }
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`⚠️ fetchMarketLiquidity failed: ${error.message}`);
      }
    }
    if (attempt < maxRetries) {
      await new Promise(res => setTimeout(res, 1000));
    }
  }
  return null;
}

module.exports = { fetchRealtimeData, fetchMarketLiquidity };
