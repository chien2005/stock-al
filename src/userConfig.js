/**
 * USER CONFIGURATION
 * Cấu hình công khai cho AI Stock Hunter T+ & Global Market.
 */

const { SEED_INSTRUMENTS } = require('./stock_hunter/config/universeSeed');

module.exports = {
  // Toàn bộ danh sách Seed Universe (131 mã) cho AI Stock Hunter
  stockSymbols: SEED_INSTRUMENTS.map(i => i.symbol),

  // Cron giữ tương thích config.js & Global Market 21h
  cronSchedule: '0 10 * * 1-5',
  cronCloseSchedule: '5 15 * * 1-5',
  cronAiSchedule: '30 20 * * 1-5',
  cronGlobalSchedule: '0 21 * * *',
  cronWeeklySchedule: '30 8 * * 1',
};
