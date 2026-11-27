/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📦 VN30F V10.0 — Market Data Service & Envelope            ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Implements MarketDataEnvelope (SRS Section 4.1)              ║
 * ║  Unified contract for all incoming market feeds               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { DataQualityGate, QUALITY_STATES, PROFILES } = require('./dataQualityGate');
const { resolveActiveContracts } = require('./contractResolver');

class MarketDataService {
  constructor(options = {}) {
    this.qualityGate = options.qualityGate || new DataQualityGate();
    this.clock = options.clock || { now: () => Date.now() };
    this.lastEnvelope = null;
    this.activeContract = null;
  }

  /**
   * Creates a normalized MarketDataEnvelope from raw inputs.
   * @param {object} params
   * @returns {object} MarketDataEnvelope
   */
  createEnvelope({
    chartCode = 'VN30F1M',
    contractId = null,
    sessionId = null,
    eventId = null,
    source = 'VPS_SNAPSHOT',
    eventType = 'SNAPSHOT',
    exchangeTs = null,
    receivedTs = null,
    sourceSequence = null,
    price = 0,
    prevPrice = null,
    cumulativeVolume = 0,
    lastTradeVolume = null,
    bid = null,
    ask = null,
    bidSize = null,
    askSize = null,
    high = null,
    low = null,
    flags = {},
    quality = {},
  }) {
    const now = this.clock.now();
    const event = {
      schemaVersion: 1,
      instrument: {
        chartCode,
        contractId: contractId || this.activeContract?.symbol || 'UNKNOWN',
      },
      sessionId: sessionId || this._getCurrentSessionId(now),
      eventId: eventId || `EVT_${now}_${Math.random().toString(36).substring(2, 8)}`,
      source,
      eventType,
      exchangeTs,                  // null if unverified by provider
      receivedTs: receivedTs || now,
      sourceSequence,
      price: typeof price === 'number' ? price : parseFloat(price) || 0,
      prevPrice: typeof prevPrice === 'number' ? prevPrice : (parseFloat(prevPrice) || price),
      high: high !== null ? high : price,
      low: low !== null ? low : price,
      cumulativeVolume: typeof cumulativeVolume === 'number' ? cumulativeVolume : (parseInt(cumulativeVolume) || 0),
      lastTradeVolume,
      bid,
      ask,
      bidSize,
      askSize,
      flags: {
        cached: Boolean(flags.cached),
        fallback: Boolean(flags.fallback),
        timestampVerified: Boolean(flags.timestampVerified),
        noTradeSinceLast: Boolean(flags.noTradeSinceLast),
      },
      quality: {
        mode: quality.mode || PROFILES.L1_SNAPSHOT,
        ageMs: quality.ageMs !== undefined ? quality.ageMs : 0,
        state: quality.state || QUALITY_STATES.FRESH,
        reasons: quality.reasons || [],
      },
    };

    // Run quality validation gate
    const validation = this.qualityGate.validateEvent(event, this.lastEnvelope, now);
    event.quality.state = validation.state;
    event.quality.reasons = validation.reasons;
    event.quality.ageMs = validation.ageMs;

    this.lastEnvelope = event;
    return event;
  }

  _getCurrentSessionId(nowTs) {
    const d = new Date(nowTs);
    const vnDateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }); // YYYY-MM-DD
    const hour = parseInt(d.toLocaleTimeString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit' }), 10);
    const sessionPeriod = hour < 12 ? 'AM' : 'PM';
    return `${vnDateStr}-${sessionPeriod}`;
  }

  getLastEnvelope() {
    return this.lastEnvelope;
  }
}

module.exports = {
  MarketDataService,
  QUALITY_STATES,
  PROFILES,
};
