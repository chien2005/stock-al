/**
 * ════════════════════════════════════════════════════════════════
 * VN30F AI TRADING JOURNAL — GOOGLE APPS SCRIPT WEB APP (v8.2)
 * ════════════════════════════════════════════════════════════════
 * HƯỚNG DẪN CẬP NHẬT TRONG 30 GIÂY:
 * 1. Mở trang Google Sheet của bạn trên trình duyệt.
 * 2. Vào menu: Tiện ích mở rộng (Extensions) ➔ Apps Script.
 * 3. Xóa toàn bộ code cũ trong Apps Script, dán toàn bộ code này vào.
 * 4. Bấm Lưu (Ctrl+S).
 * 5. Bấm "Triển khai" (Deploy) ➔ "Quản lý tùy chọn triển khai" (Manage deployments):
 *    - Bấm vào biểu tượng cây bút chì (Chỉnh sửa / Edit).
 *    - Tại mục Phiên bản (Version): Chọn "Phiên bản mới" (New version).
 *    - Bấm "Triển khai" (Deploy) ➔ XONG (URL giữ nguyên không đổi)!
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
      const header = [
        'Ngày',
        'Lệnh #',
        'Loại lệnh',
        'Giờ vào (HH:mm:ss)',
        'Giá vào',
        'Giờ ra (HH:mm:ss)',
        'Giá ra',
        'Lãi/Lỗ thô',
        'Phí (0.6đ)',
        'LÃI/LỖ THỰC (Net)',
        'Đánh giá (TP/SL)',
        'Tổng ngày đến lúc này',
        'Lý do đóng lệnh'
      ];

      if (!sheet) {
        sheet = ss.insertSheet('NhatKyLenh');
        sheet.appendRow(header);
        sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#2E75B6').setFontColor('#FFFFFF');
        sheet.setFrozenRows(1);
      } else if (sheet.getLastRow() === 0 || sheet.getLastColumn() !== header.length) {
        // Tự động đồng bộ tiêu đề nếu chưa đúng chuẩn mới
        sheet.getRange(1, 1, 1, header.length).setValues([header])
          .setFontWeight('bold').setBackground('#2E75B6').setFontColor('#FFFFFF');
        sheet.setFrozenRows(1);
      }

      const grossStr = `${data.grossPnL >= 0 ? '+' : ''}${Number(data.grossPnL).toFixed(1)}đ`;
      const feeStr = `-${Number(data.fee || 0.6).toFixed(1)}đ`;
      const netStr = `${data.netPnL >= 0 ? '+' : ''}${Number(data.netPnL).toFixed(1)}đ`;
      const cumStr = `${data.cumulativeDayNetPnL >= 0 ? '+' : ''}${Number(data.cumulativeDayNetPnL).toFixed(1)}đ`;
      const evalTag = data.resultLabel || (data.netPnL > 0 ? `TP (+${Number(data.netPnL).toFixed(1)}đ)` : (data.netPnL < 0 ? `SL (${Number(data.netPnL).toFixed(1)}đ)` : 'HÒA (0.0đ)'));

      const row = [
        data.date,
        `Lệnh #${data.orderNum || data.id || 1}`,
        data.type, // 'LONG' | 'SHORT'
        data.entryTime, // Giờ:Phút:Giây (HH:mm:ss)
        Number(data.entryPrice).toFixed(1),
        data.exitTime,  // Giờ:Phút:Giây (HH:mm:ss)
        Number(data.exitPrice).toFixed(1),
        grossStr,
        feeStr,
        netStr,
        evalTag, // TP (+X.Xđ) hoặc SL (-X.Xđ)
        cumStr,  // Tổng ngày đến thời điểm đó
        data.reason || ''
      ];
      sheet.appendRow(row);

      // Định dạng màu chữ cho Net PnL và Đánh giá (Cột 10 & 11)
      const lastRow = sheet.getLastRow();
      const isWin = data.netPnL > 0;
      const isLoss = data.netPnL < 0;
      const color = isWin ? '#008000' : (isLoss ? '#CC0000' : '#888888');
      sheet.getRange(lastRow, 10).setFontColor(color).setFontWeight('bold');
      sheet.getRange(lastRow, 11).setFontColor(color).setFontWeight('bold');

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Logged trade' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ─── 2. GHI NHẬN BÁO CÁO TỔNG KẾT NGÀY ────────────────────
    if (action === 'appendDailySummary') {
      let sheet = ss.getSheetByName('TongKetNgay');
      const header = [
        'Ngày',
        'Tổng số lệnh',
        'Thắng (W)',
        'Thua (L)',
        'Win Rate Ngày',
        'Win Rate Tuần',
        'Win Rate Tháng',
        'Win Rate Hiện Tại',
        'Điểm thô (Gross)',
        'Tổng phí',
        'LÃI/LỖ THỰC NGÀY (Net)',
        'Lũy kế toàn bộ',
        'Đánh giá ngày (TP/SL)'
      ];

      if (!sheet) {
        sheet = ss.insertSheet('TongKetNgay');
        sheet.appendRow(header);
        sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#1F4E79').setFontColor('#FFFFFF');
        sheet.setFrozenRows(1);
      } else if (sheet.getLastRow() === 0 || sheet.getLastColumn() !== header.length) {
        sheet.getRange(1, 1, 1, header.length).setValues([header])
          .setFontWeight('bold').setBackground('#1F4E79').setFontColor('#FFFFFF');
        sheet.setFrozenRows(1);
      }

      const grossStr = `${data.totalGrossPnL >= 0 ? '+' : ''}${Number(data.totalGrossPnL).toFixed(1)}đ`;
      const feeStr = `-${Number(data.totalFees).toFixed(1)}đ`;
      const netStr = `${data.totalNetPnL >= 0 ? '+' : ''}${Number(data.totalNetPnL).toFixed(1)}đ`;
      const cumAllStr = data.cumulativeAllTimeNetPnL !== undefined ? `${data.cumulativeAllTimeNetPnL >= 0 ? '+' : ''}${Number(data.cumulativeAllTimeNetPnL).toFixed(1)}đ` : 'N/A';
      const evalTag = data.evaluation || (data.totalNetPnL > 0 ? `TP (+${Number(data.totalNetPnL).toFixed(1)}đ)` : (data.totalNetPnL < 0 ? `SL (${Number(data.totalNetPnL).toFixed(1)}đ)` : 'HÒA (0.0đ)'));

      const row = [
        data.date,
        `${data.totalTrades} lệnh`,
        `${data.winTrades}W`,
        `${data.lossTrades}L`,
        data.winRateDay || data.winRate || '0%',
        data.winRateWeek || data.winRate || '0%',
        data.winRateMonth || data.winRate || '0%',
        data.winRateAllTime || data.winRate || '0%',
        grossStr,
        feeStr,
        netStr, // Xem âm hay dương bao nhiêu điểm cuối ngày
        cumAllStr,
        evalTag // TP (+X.Xđ) hoặc SL (-X.Xđ)
      ];
      sheet.appendRow(row);

      // Định dạng màu chữ cho Net PnL và Đánh giá (Cột 11 & 13)
      const lastRow = sheet.getLastRow();
      const isWin = data.totalNetPnL > 0;
      const isLoss = data.totalNetPnL < 0;
      const color = isWin ? '#008000' : (isLoss ? '#CC0000' : '#888888');
      sheet.getRange(lastRow, 11).setFontColor(color).setFontWeight('bold');
      sheet.getRange(lastRow, 13).setFontColor(color).setFontWeight('bold');

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
