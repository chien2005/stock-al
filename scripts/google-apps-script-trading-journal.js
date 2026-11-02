/**
 * ════════════════════════════════════════════════════════════════
 * VN30F AI TRADING JOURNAL — GOOGLE APPS SCRIPT WEB APP
 * ════════════════════════════════════════════════════════════════
 * HƯỚNG DẪN 3 BƯỚC CÀI ĐẶT TRONG 1 PHÚT:
 * 1. Mở trang Google Sheet của bạn trên trình duyệt.
 * 2. Vào menu: Tiện ích mở rộng (Extensions) ➔ Apps Script.
 * 3. Xóa hết code cũ, dán toàn bộ đoạn code này vào ➔ Bấm Save (Ctrl+S).
 * 4. Bấm "Triển khai" (Deploy) ➔ "Tùy chọn triển khai mới" (New deployment).
 *    - Chọn loại: Ứng dụng web (Web app).
 *    - Thực thi dưới dạng (Execute as): "Tôi" (Me).
 *    - Người có quyền truy cập (Who has access): "Bất kỳ ai" (Anyone).
 * 5. Bấm "Triển khai" (Deploy) ➔ Cấp quyền truy cập ➔ Copy URL "Ứng dụng web".
 * 6. Dán URL đó vào file .env hoặc Render Environment Variables:
 *    GOOGLE_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
 * ════════════════════════════════════════════════════════════════
 */

function doPost(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = contents.action;
    const data = contents.data;

    // ─── 1. GHI NHẬN TỪNG LỆNH GIAO DỊCH (NHẬT KÝ LỆNH) ────────
    if (action === 'appendTrade') {
      let sheet = ss.getSheetByName('NhatKyLenh');
      if (!sheet) {
        sheet = ss.insertSheet('NhatKyLenh');
        const header = [
          'Ngày', 'Hợp đồng', 'Lệnh #', 'Vị thế',
          'Giờ vào', 'Giá vào', 'Giờ ra', 'Giá ra',
          'Điểm thô (Gross)', 'Phí thuế (0.6đ)', 'LÃI/LỖ THỰC (Net)',
          'Kết quả', 'Lý do đóng lệnh', 'Lũy kế ngày'
        ];
        sheet.appendRow(header);
        sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#2E75B6').setFontColor('#FFFFFF');
        sheet.setFrozenRows(1);
      }

      const row = [
        data.date,
        data.contract || 'VN30F1M',
        `Lệnh #${data.orderNum || data.id}`,
        data.type,
        data.entryTime,
        data.entryPrice,
        data.exitTime,
        data.exitPrice,
        data.grossPnL,
        data.fee,
        data.netPnL,
        data.resultLabel,
        data.reason,
        data.cumulativeDayNetPnL
      ];
      sheet.appendRow(row);

      // Định dạng màu chữ cho kết quả
      const lastRow = sheet.getLastRow();
      const netCell = sheet.getRange(lastRow, 11);
      if (data.netPnL > 0) {
        netCell.setFontColor('#008000').setFontWeight('bold');
      } else if (data.netPnL < 0) {
        netCell.setFontColor('#CC0000').setFontWeight('bold');
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Logged trade' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ─── 2. GHI NHẬN BÁO CÁO TỔNG KẾT NGÀY ────────────────────
    if (action === 'appendDailySummary') {
      let sheet = ss.getSheetByName('TongKetNgay');
      if (!sheet) {
        sheet = ss.insertSheet('TongKetNgay');
        const header = [
          'Ngày', 'Tổng số lệnh', 'Lệnh Thắng', 'Lệnh Thua',
          'Tỉ lệ thắng', 'Điểm thô (Gross)', 'Tổng phí thuế',
          'LÃI/LỖ THỰC (Net)', 'Đánh giá'
        ];
        sheet.appendRow(header);
        sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#1F4E79').setFontColor('#FFFFFF');
        sheet.setFrozenRows(1);
      }

      const row = [
        data.date,
        data.totalTrades,
        data.winTrades,
        data.lossTrades,
        data.winRate,
        data.totalGrossPnL,
        data.totalFees,
        data.totalNetPnL,
        data.evaluation
      ];
      sheet.appendRow(row);

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Logged daily summary' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
