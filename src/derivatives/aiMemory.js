/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   🧠 VN30F — AI Memory & Narrative State Diffing (v9.0)       ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  Bộ nhớ liên phiên cho AI Supervisor:                         ║
 * ║  • Lưu trữ kịch bản phiên trước & các diễn biến cốt lõi      ║
 * ║  • State Diffing: So sánh biến đổi thị trường sau 30-60 phút ║
 * ║  • Phát hiện đột biến Basis, dòng tiền Tây, vùng tranh chấp  ║
 * ║  • Tránh tình trạng AI 'mất trí nhớ' mỗi lần kích hoạt      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'ai_supervisor_memory.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Đọc bộ nhớ AI từ ổ đĩa
 */
function loadMemory() {
  ensureDataDir();
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('⚠️ [AIMemory] Lỗi đọc ai_supervisor_memory.json:', err.message);
  }

  // Cấu trúc mặc định ban đầu
  return {
    lastUpdated: new Date().toISOString(),
    sessionNarratives: [], // Tối đa 10 phiên gần nhất
    latestSnapshot: null,
    activeWatchZones: [],
    strategicBias: 'NEUTRAL',
  };
}

/**
 * Ghi bộ nhớ AI vào ổ đĩa
 */
function saveMemory(memory) {
  ensureDataDir();
  try {
    memory.lastUpdated = new Date().toISOString();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('⚠️ [AIMemory] Lỗi ghi ai_supervisor_memory.json:', err.message);
    return false;
  }
}

/**
 * So sánh trạng thái hiện tại với snapshot trước đó (State Diffing)
 * @param {object} currentState - { price, basis, foreignNet, regime, zoneStatus }
 * @returns {object} { hasMeaningfulChange, diffs, narrativeText }
 */
function compareWithPreviousState(currentState) {
  const memory = loadMemory();
  const prev = memory.latestSnapshot;

  if (!prev) {
    return {
      hasMeaningfulChange: false,
      diffs: ['Lần khởi chạy đầu tiên, chưa có dữ liệu đối chiếu trước đó.'],
      narrativeText: 'Khởi tạo bộ nhớ phiên mới.',
    };
  }

  const diffs = [];
  let isMeaningful = false;

  // 1. Biến động giá (>= 4.0 điểm)
  if (currentState.price && prev.price) {
    const deltaPrice = +(currentState.price - prev.price).toFixed(1);
    if (Math.abs(deltaPrice) >= 4.0) {
      isMeaningful = true;
      const arrow = deltaPrice > 0 ? '🚀 TĂNG' : '🔻 GIẢM';
      diffs.push(`Giá dịch chuyển mạnh: ${arrow} ${deltaPrice > 0 ? '+' : ''}${deltaPrice}đ (từ ${prev.price} ➔ ${currentState.price})`);
    }
  }

  // 2. Co giãn Basis (>= 2.5 điểm hoặc chạm vùng bất thường)
  if (currentState.basis !== undefined && prev.basis !== undefined) {
    const deltaBasis = +(currentState.basis - prev.basis).toFixed(1);
    if (Math.abs(deltaBasis) >= 2.5) {
      isMeaningful = true;
      const stretchType = deltaBasis > 0 ? 'thu hẹp Basis âm / mở rộng Basis dương' : 'giãn Basis âm mạnh';
      diffs.push(`Basis co giãn đột ngột: ${deltaBasis > 0 ? '+' : ''}${deltaBasis}đ (${prev.basis}đ ➔ ${currentState.basis}đ, ${stretchType})`);
    }
  }

  // 3. Khối ngoại quay xe / thay đổi đột biến (>= 1.000 HĐ)
  if (currentState.foreignNet !== undefined && prev.foreignNet !== undefined) {
    const deltaForeign = currentState.foreignNet - prev.foreignNet;
    if (Math.abs(deltaForeign) >= 1000) {
      isMeaningful = true;
      const act = deltaForeign > 0 ? 'Cover/Mua ròng thêm' : 'Xả/Bán ròng thêm';
      diffs.push(`Khối Ngoại thay đổi quy mô: ${act} ${deltaForeign > 0 ? '+' : ''}${deltaForeign.toLocaleString()} HĐ (từ ${prev.foreignNet.toLocaleString()} ➔ ${currentState.foreignNet.toLocaleString()} HĐ)`);
    }
  }

  // 4. Thay đổi Regime thị trường
  if (currentState.regime && prev.regime && currentState.regime !== prev.regime) {
    isMeaningful = true;
    diffs.push(`Chuyển đổi Regime: Từ [${prev.regime}] ➔ [${currentState.regime}]`);
  }

  // 5. Tương tác với Dynamic Zones
  if (currentState.zoneAction && currentState.zoneAction !== prev.zoneAction) {
    isMeaningful = true;
    diffs.push(`Hành vi vùng S/R: ${currentState.zoneAction}`);
  }

  const narrativeText = diffs.length > 0
    ? diffs.join('\n• ')
    : 'Thị trường vận động ổn định, chưa có thay đổi cấu trúc đột biến so với 30 phút trước.';

  return {
    hasMeaningfulChange: isMeaningful,
    diffs,
    narrativeText,
  };
}

/**
 * Ghi nhận snapshot mới vào bộ nhớ
 */
function recordSnapshot(snapshot) {
  const memory = loadMemory();
  memory.latestSnapshot = {
    timestamp: Date.now(),
    time: snapshot.time || new Date().toLocaleTimeString('vi-VN'),
    price: snapshot.price,
    basis: snapshot.basis,
    foreignNet: snapshot.foreignNet,
    regime: snapshot.regime,
    zoneAction: snapshot.zoneAction || null,
  };
  saveMemory(memory);
}

/**
 * Lưu tóm tắt phiên sau khi kết thúc phiên (Post-ATC hoặc Evening)
 */
function recordSessionNarrative(sessionData) {
  const memory = loadMemory();
  const narrative = {
    date: sessionData.date || new Date().toLocaleDateString('vi-VN'),
    session: sessionData.session || 'POST_ATC',
    closePrice: sessionData.closePrice,
    basis: sessionData.basis,
    foreignNet: sessionData.foreignNet,
    strategicRegime: sessionData.strategicRegime,
    keySupport: sessionData.keySupport,
    keyResistance: sessionData.keyResistance,
    summary: sessionData.summary,
    timestamp: Date.now(),
  };

  // Giữ tối đa 10 phiên gần nhất
  memory.sessionNarratives = [narrative, ...memory.sessionNarratives.slice(0, 9)];
  memory.strategicBias = sessionData.strategicBias || memory.strategicBias;
  saveMemory(memory);
  console.log(`   🧠 [AIMemory] Đã lưu kịch bản phiên [${narrative.date}] vào bộ nhớ AI.`);
}

/**
 * Lấy bối cảnh bộ nhớ để nạp vào AI Prompt
 */
function getMemoryContext() {
  const memory = loadMemory();
  const lastNarrative = memory.sessionNarratives[0];

  if (!lastNarrative) {
    return 'Chưa có kịch bản phiên trước được lưu trữ.';
  }

  return [
    `📅 KỊCH BẢN PHIÊN GẦN NHẤT (${lastNarrative.date} - ${lastNarrative.session}):`,
    `• Giá đóng: ${lastNarrative.closePrice || 'N/A'} | Basis: ${lastNarrative.basis !== undefined ? `${lastNarrative.basis > 0 ? '+' : ''}${lastNarrative.basis}đ` : 'N/A'}`,
    `• Vị thế Ngoại qua đêm: ${lastNarrative.foreignNet !== undefined ? `${lastNarrative.foreignNet > 0 ? '+' : ''}${lastNarrative.foreignNet.toLocaleString()} HĐ` : 'N/A'}`,
    `• Cấu trúc then chốt: Hỗ trợ cứng [${lastNarrative.keySupport || 'N/A'}], Kháng cự chính [${lastNarrative.keyResistance || 'N/A'}]`,
    `• Regime chủ đạo: [${lastNarrative.strategicRegime || 'N/A'}]`,
    `• Kết luận chiến lược: "${lastNarrative.summary || 'Theo dõi phản ứng tại các vùng cực trị.'}"`,
  ].join('\n');
}

module.exports = {
  loadMemory,
  saveMemory,
  compareWithPreviousState,
  recordSnapshot,
  recordSessionNarrative,
  getMemoryContext,
};
