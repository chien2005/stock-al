/**
 * AI STOCK HUNTER - Public Module Entry Point
 */

const { STOCK_HUNTER_CONFIG } = require('./config/stockHunterConfig');
const { SEED_INSTRUMENTS, SEED_GROUPS, getInstrumentMeta } = require('./config/universeSeed');
const calendar = require('./core/calendar');
const tickRules = require('./core/tickRules');
const marketDataProvider = require('./data/marketDataProvider');
const universe = require('./engines/universe');
const features = require('./engines/features');
const zones = require('./engines/zones');
const marketRegime = require('./engines/marketRegime');
const sectorRotation = require('./engines/sectorRotation');
const supplyDemand = require('./engines/supplyDemand');
const specialWatch = require('./engines/specialWatch');
const avoidList = require('./engines/avoidList');
const strategies = require('./engines/strategies');
const tradePlan = require('./engines/tradePlan');
const riskEngine = require('./engines/riskEngine');
const exitEngine = require('./engines/exitEngine');
const decisionEngine = require('./engines/decisionEngine');
const { LedgerService } = require('./services/ledgerService');
const { StateStore } = require('./services/stateStore');
const notifierService = require('./services/notifierService');
const scanService = require('./services/scanService');

module.exports = {
  STOCK_HUNTER_CONFIG,
  SEED_INSTRUMENTS,
  SEED_GROUPS,
  getInstrumentMeta,
  calendar,
  tickRules,
  marketDataProvider,
  universe,
  features,
  zones,
  marketRegime,
  sectorRotation,
  supplyDemand,
  specialWatch,
  avoidList,
  strategies,
  tradePlan,
  riskEngine,
  exitEngine,
  decisionEngine,
  LedgerService,
  StateStore,
  notifierService,
  ...scanService,
};
