/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🎬 VN30F V10.0 — Replay Service (Section 14.2)              ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Injects virtual clock and feeds historical snapshot/bar     ║
 * ║  fixtures sequentially without look-ahead bias                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { SessionClock } = require('../core/sessionClock');
const { ProactivePricePathForecastEngine } = require('../forecast/forecastEngine');
const { OutcomeEvaluator } = require('../forecast/outcomeEvaluator');
const { MetricsService } = require('./metricsService');
const { EventJournal } = require('./eventJournal');

class ReplayService {
  constructor() {
    this.clock = new SessionClock();
    this.journal = new EventJournal();
    this.metricsService = new MetricsService();
    this.outcomeEvaluator = new OutcomeEvaluator();
    this.ppfe = new ProactivePricePathForecastEngine({
      clock: this.clock,
    });
  }

  /**
   * Run replay on sequential historical bars fixture.
   * @param {object[]} fixtureBars - Array of { timestamp, open, high, low, close, volume }
   * @returns {object} Replay execution summary & metrics
   */
  runReplay(fixtureBars = []) {
    if (!Array.isArray(fixtureBars) || fixtureBars.length === 0) {
      return { status: 'EMPTY_FIXTURE' };
    }

    const emittedForecasts = [];

    // Step through each bar as "current as-of"
    for (let i = 0; i < fixtureBars.length; i++) {
      const bar = fixtureBars[i];
      const asOfMs = (bar.timestamp || 1700000000 + i * 60) * 1000;
      this.clock.setVirtualTime(asOfMs);

      // Only slice history strictly <= current index (zero look-ahead bias)
      const historicalCandles = fixtureBars.slice(0, i + 1);
      const currentPrice = bar.close;

      this.journal.logEvent('REPLAY_BAR', { index: i, price: currentPrice }, asOfMs);

      // Construct feature bundle proxy from historical candles
      const closes = historicalCandles.map(c => c.close);
      const highs = historicalCandles.map(c => c.high || c.close);
      const lows = historicalCandles.map(c => c.low || c.close);

      const isCompressing = highs.length >= 4 && (Math.max(...highs.slice(-4)) - Math.min(...lows.slice(-4))) <= 2.5;

      const featureBundle = {
        g1Structure: {
          trend: closes.length >= 5 && closes[closes.length - 1] > closes[closes.length - 5] ? 'UPTREND' : 'DOWNTREND',
          hhhlPattern: closes.length >= 3 && closes[closes.length - 1] >= closes[closes.length - 2] ? 'HIGHER_HIGHS' : 'LOWER_HIGHS',
          swingHigh: Math.max(...highs),
          swingLow: Math.min(...lows),
        },
        g2Pressure: {
          pressureSide: closes[closes.length - 1] > bar.open ? 'BUY' : 'SELL',
        },
        g3Dynamics: {
          isCompressing,
          velocity15s: 0.05,
        },
        g4Location: {
          nearestResistance: { low: Math.max(...highs) + 1.0, high: Math.max(...highs) + 2.0 },
          distToResistance: 2.0,
          nearestSupport: { low: Math.min(...lows) - 2.0, high: Math.min(...lows) - 1.0 },
          distToSupport: 2.0,
        },
        g5CrossMarket: { isBasisValid: false },
        g6Context: { sessionPhase: 'MORNING' },
      };

      const result = this.ppfe.generateForecast({
        currentPrice,
        featureBundle,
        candidateZones: [
          { id: 'Z_RES', low: Math.max(...highs) + 1.0, high: Math.max(...highs) + 2.0, source: 'SWING' },
          { id: 'Z_SUP', low: Math.min(...lows) - 2.0, high: Math.min(...lows) - 1.0, source: 'SWING' },
        ],
        candles: historicalCandles,
      });

      if (result.stage === 'EARLY_FORECAST') {
        emittedForecasts.push({
          forecast: result,
          emittedAtIndex: i,
          emittedAtMs: asOfMs,
        });
        this.journal.logEvent('FORECAST_EMITTED', result, asOfMs);
      }
    }

    // Evaluate outcomes of all emitted forecasts against future candles
    for (const item of emittedForecasts) {
      const futureCandles = fixtureBars.slice(item.emittedAtIndex + 1);
      const evaluation = this.outcomeEvaluator.evaluate(item.forecast, futureCandles);
      this.metricsService.recordEvaluation({
        forecastId: item.forecast.forecastId,
        direction: item.forecast.direction,
        ...evaluation,
      });
      this.journal.logEvent('FORECAST_OUTCOME', evaluation, this.clock.now());
    }

    return {
      totalBars: fixtureBars.length,
      emittedForecastsCount: emittedForecasts.length,
      metrics: this.metricsService.computeMetrics(),
      journalEntriesCount: this.journal.getEvents().length,
    };
  }
}

module.exports = {
  ReplayService,
};
