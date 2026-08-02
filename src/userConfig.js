/**
 * 📝 USER CONFIGURATION
 * Các cấu hình công khai (Mã cổ phiếu theo dõi & Lịch Cron)
 * Được commit lên git để dễ dàng chỉnh sửa mà không cần can thiệp Railway Dashboard variables.
 */

module.exports = {
  // Danh sách các mã cổ phiếu theo dõi trong rổ dự án (báo giá hàng ngày)
  stockSymbols: [
    'VCB', 'HPG', 'BID', 'MWG', 'SSI', 'FPT', 'VIC', 'CTR', 'MBB', 'TCB', 'VHM', 'VRE', 'HHV', 'E1VFVN30'
  ],

  // ─── LỊCH PHÁT THÔNG BÁO (CRON JOBS) ──────────────────────────
  // 1. Báo giá sáng (Thứ 2 - Thứ 6, lúc 10h00)
  cronSchedule: '0 10 * * 1-5',

  // 2. Báo giá kết phiên (Thứ 2 - Thứ 6, lúc 15h01)
  cronCloseSchedule: '1 15 * * 1-5',

  // 3. AI phân tích đa chuyên gia (Thứ 2 - Thứ 6, lúc 20h30)
  cronAiSchedule: '30 20 * * 1-5',

  // 4. Báo cáo TTCK Quốc tế & Giá Vàng (Hàng ngày, lúc 21h00)
  cronGlobalSchedule: '0 21 * * *',

  // 5. Phân tích đầu tuần (Thứ 2 hàng tuần, lúc 8h30 sáng)
  cronWeeklySchedule: '30 8 * * 1',
};
