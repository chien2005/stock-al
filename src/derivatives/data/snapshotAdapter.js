/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🔄 VN30F V10.0 — Snapshot Adapter (FIX-01)                  ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Adapts VPS real-time snapshots, history & cache to standard  ║
 * ║  MarketDataEnvelope. Prevents fake tick generation.           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const { MarketDataService } = require('./marketDataService');
const { resolveActiveContracts } = require('./contractResolver');

const VPS_PS_SNAPSHOT = 'https://bgapidatafeed.vps.com.vn/getpsalldatalsnapshot';
const VPS_INDEX_DETAIL_URL = 'https://bgapidatafeed.vps.com.vn/getlistindexdetail';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

class SnapshotAdapter {
  constructor(marketDataService = new MarketDataService()) {
    this.marketDataService = marketDataService;
  }

  /**
   * Fetches the latest live futures snapshot and returns a validated MarketDataEnvelope.
   * @param {string} chartCode - 'VN30F1M' or 'VN30F2M'
   * @returns {Promise<object>} MarketDataEnvelope
   */
  async fetchFuturesEnvelope(chartCode = 'VN30F1M') {
    const isF2 = chartCode === 'VN30F2M';
    const contractInfo = await resolveActiveContracts();
    const contract = isF2 ? contractInfo.f2m : contractInfo.f1m;

    if (!contract || !contract.symbol) {
      // Unresolved contract mapping (DQ-08) -> Degraded envelope
      return this.marketDataService.createEnvelope({
        chartCode,
        source: 'CONTRACT_UNRESOLVED',
        eventType: 'DEGRADED',
        price: 0,
        flags: { fallback: true },
        quality: { state: 'CONTRACT_MISMATCH', reasons: ['UNRESOLVED_CONTRACT_MAPPING'] },
      });
    }

    try {
      const res = await axios.get(`${VPS_PS_SNAPSHOT}/${contract.symbol}`, {
        headers: HEADERS,
        timeout: 4000,
      });

      if (Array.isArray(res.data) && res.data.length > 0 && res.data[0].lastPrice) {
        const d = res.data[0];
        const price = parseFloat(d.lastPrice);
        const prevPrice = d.r ? parseFloat(d.r) : (d.closePrice ? parseFloat(d.closePrice) : price);
        const lot = parseInt(d.lot || '0', 10);
        const lastVolume = parseInt(d.lastVolume || '0', 10);
        const high = d.highPrice ? parseFloat(d.highPrice) : price;
        const low = d.lowPrice ? parseFloat(d.lowPrice) : price;

        return this.marketDataService.createEnvelope({
          chartCode,
          contractId: contract.symbol,
          source: 'VPS_SNAPSHOT',
          eventType: 'SNAPSHOT',
          price,
          prevPrice,
          high,
          low,
          cumulativeVolume: lot,
          lastTradeVolume: lastVolume,
          flags: {
            cached: false,
            fallback: false,
            timestampVerified: false, // Snapshot does not provide millisecond exchangeTs
          },
          quality: {
            mode: 'L1_SNAPSHOT',
            state: 'FRESH',
          },
        });
      }
    } catch (err) {
      // Request failed
    }

    // Fallback: Degraded envelope
    return this.marketDataService.createEnvelope({
      chartCode,
      contractId: contract.symbol,
      source: 'VPS_SNAPSHOT_TIMEOUT',
      eventType: 'FALLBACK',
      price: this.marketDataService.getLastEnvelope()?.price || 0,
      flags: { cached: true, fallback: true },
      quality: { state: 'DEGRADED', reasons: ['NETWORK_TIMEOUT_USING_CACHE'] },
    });
  }

  /**
   * Fetches realtime VN30 index snapshot
   */
  async fetchVN30Snapshot() {
    try {
      const res = await axios.get(`${VPS_INDEX_DETAIL_URL}/11`, {
        headers: HEADERS,
        timeout: 4000,
      });
      if (Array.isArray(res.data) && res.data.length > 0) {
        const item = res.data[0];
        const price = item.cIndex ? parseFloat(item.cIndex) : null;
        const prevPrice = item.oIndex ? parseFloat(item.oIndex) : price;
        const volume = item.vol ? parseInt(item.vol, 10) : 0;
        return {
          price,
          prevPrice,
          volume,
          receivedTs: Date.now(),
          valid: price !== null,
        };
      }
    } catch (e) {}
    return { price: null, prevPrice: null, volume: 0, receivedTs: Date.now(), valid: false };
  }
}

module.exports = {
  SnapshotAdapter,
};
