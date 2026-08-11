/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║   🌐 VN STOCK BOT — Dynamic VN30 Component Resolver      ║
 * ╠═══════════════════════════════════════════════════════════╣
 * ║  Tự động cập nhật danh sách rổ VN30 realtime từ sàn       ║
 * ║  - Đảm bảo khi rổ VN30 thay đổi (thêm/bớt mã như TCX, MCH) ║
 * ║    hệ thống tự động nhận diện mà không cần sửa code thủ công║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const axios = require('axios');

// Danh sách VN30 dự phòng (Fallback & Tham chiếu trọng số)
const DEFAULT_VN30_COMPONENTS = [
  { sym: 'VCB',  weight: 13.5, isPillar: true },
  { sym: 'VIC',  weight: 9.5,  isPillar: true },
  { sym: 'VHM',  weight: 8.5,  isPillar: true },
  { sym: 'BID',  weight: 7.2,  isPillar: true },
  { sym: 'CTG',  weight: 6.5  },
  { sym: 'GAS',  weight: 6.0  },
  { sym: 'FPT',  weight: 5.8,  isPillar: true },
  { sym: 'SAB',  weight: 5.5  },
  { sym: 'TCB',  weight: 4.8  },
  { sym: 'HPG',  weight: 4.5  },
  { sym: 'MBB',  weight: 4.2  },
  { sym: 'MWG',  weight: 4.0,  isPillar: true },
  { sym: 'VPB',  weight: 3.8  },
  { sym: 'ACB',  weight: 3.5  },
  { sym: 'STB',  weight: 3.0  },
  { sym: 'VNM',  weight: 2.8  },
  { sym: 'SSI',  weight: 2.5  },
  { sym: 'MSN',  weight: 2.2  },
  { sym: 'VND',  weight: 2.0  },
  { sym: 'GVR',  weight: 1.8  },
  { sym: 'BCM',  weight: 1.5  },
  { sym: 'VRE',  weight: 1.5  },
  { sym: 'HCM',  weight: 1.2  },
  { sym: 'POW',  weight: 1.2  },
  { sym: 'VJC',  weight: 1.0  },
  { sym: 'TCX',  weight: 1.0  },
  { sym: 'MCH',  weight: 1.0  },
  { sym: 'LPB',  weight: 0.8  },
  { sym: 'SHB',  weight: 0.8  },
  { sym: 'BSR',  weight: 0.6  },
  { sym: 'HDB',  weight: 1.5  },
  { sym: 'VIB',  weight: 1.0  },
  { sym: 'SSB',  weight: 1.0  },
];

let cachedSymbols = null;
let lastFetchTime = 0;
const CACHE_TTL = 3600 * 1000; // Cache 1 giờ

/**
 * Tải danh sách mã VN30 thực tế ngay từ thị trường
 */
async function fetchLiveVN30Symbols() {
  const now = Date.now();
  if (cachedSymbols && (now - lastFetchTime < CACHE_TTL)) {
    return cachedSymbols;
  }

  try {
    const res = await axios.get('https://price.dnse.com.vn/api/v1/stocks?group=VN30', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 5000,
    });
    const match = res.data.match(/symbols:(\[.*?\])/);
    if (match) {
      const symbols = JSON.parse(match[1]);
      if (Array.isArray(symbols) && symbols.length >= 25) {
        cachedSymbols = symbols;
        lastFetchTime = now;
        console.log(`🌐 [VN30 Dynamic Resolver] Cập nhật thành công ${symbols.length} mã VN30 realtime từ sàn: ${symbols.join(', ')}`);
        return symbols;
      }
    }
  } catch (e) {
    console.log(`⚠️ [VN30 Dynamic Resolver] Không lấy được danh sách VN30 realtime (${e.message}), chuyển sang danh sách dự phòng.`);
  }

  // Fallback to default list
  cachedSymbols = DEFAULT_VN30_COMPONENTS.map(c => c.sym);
  lastFetchTime = now;
  return cachedSymbols;
}

/**
 * Lấy đối tượng rổ VN30 có cấu trúc kèm trọng số và cờ mã trụ
 */
async function getLiveVN30Components() {
  const liveSymbols = await fetchLiveVN30Symbols();
  return liveSymbols.map(sym => {
    const known = DEFAULT_VN30_COMPONENTS.find(c => c.sym === sym);
    if (known) return known;
    const isPillar = ['VCB', 'VIC', 'VHM', 'FPT', 'BID', 'MWG'].includes(sym);
    return { sym, weight: 1.5, isPillar };
  });
}

module.exports = {
  fetchLiveVN30Symbols,
  getLiveVN30Components,
  DEFAULT_VN30_COMPONENTS,
};
