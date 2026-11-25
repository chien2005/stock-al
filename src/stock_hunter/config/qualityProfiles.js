/**
 * AI STOCK HUNTER V2.1 - Hồ sơ Chất lượng Doanh nghiệp đã Thẩm định
 * Lưu trạng thái kiểm toán, trạng thái niêm yết/cảnh báo, và cờ sự kiện trọng yếu.
 * Các mã chưa có hồ sơ chi tiết được gắn `verified: false` (QUALITY_UNKNOWN) thay vì bịa điểm.
 */

const QUALITY_PROFILES = {
  // Nhóm VN30 & Đầu ngành đã có hồ sơ cơ bản chuẩn
  VCB: { verified: true, status: 'ACTIVE', qualityScore: 92, qualityCoverage: 1.0, materialEventBlock: false },
  BID: { verified: true, status: 'ACTIVE', qualityScore: 84, qualityCoverage: 1.0, materialEventBlock: false },
  CTG: { verified: true, status: 'ACTIVE', qualityScore: 82, qualityCoverage: 1.0, materialEventBlock: false },
  TCB: { verified: true, status: 'ACTIVE', qualityScore: 88, qualityCoverage: 1.0, materialEventBlock: false },
  MBB: { verified: true, status: 'ACTIVE', qualityScore: 85, qualityCoverage: 1.0, materialEventBlock: false },
  ACB: { verified: true, status: 'ACTIVE', qualityScore: 87, qualityCoverage: 1.0, materialEventBlock: false },
  VPB: { verified: true, status: 'ACTIVE', qualityScore: 76, qualityCoverage: 1.0, materialEventBlock: false },
  STB: { verified: true, status: 'ACTIVE', qualityScore: 75, qualityCoverage: 1.0, materialEventBlock: false },
  HDB: { verified: true, status: 'ACTIVE', qualityScore: 80, qualityCoverage: 1.0, materialEventBlock: false },
  SSI: { verified: true, status: 'ACTIVE', qualityScore: 82, qualityCoverage: 1.0, materialEventBlock: false },
  VCI: { verified: true, status: 'ACTIVE', qualityScore: 80, qualityCoverage: 1.0, materialEventBlock: false },
  HCM: { verified: true, status: 'ACTIVE', qualityScore: 79, qualityCoverage: 1.0, materialEventBlock: false },
  FPT: { verified: true, status: 'ACTIVE', qualityScore: 93, qualityCoverage: 1.0, materialEventBlock: false },
  CTR: { verified: true, status: 'ACTIVE', qualityScore: 82, qualityCoverage: 1.0, materialEventBlock: false },
  HPG: { verified: true, status: 'ACTIVE', qualityScore: 85, qualityCoverage: 1.0, materialEventBlock: false },
  MWG: { verified: true, status: 'ACTIVE', qualityScore: 81, qualityCoverage: 1.0, materialEventBlock: false },
  PNJ: { verified: true, status: 'ACTIVE', qualityScore: 83, qualityCoverage: 1.0, materialEventBlock: false },
  FRT: { verified: true, status: 'ACTIVE', qualityScore: 74, qualityCoverage: 1.0, materialEventBlock: false },
  GAS: { verified: true, status: 'ACTIVE', qualityScore: 86, qualityCoverage: 1.0, materialEventBlock: false },
  PLX: { verified: true, status: 'ACTIVE', qualityScore: 78, qualityCoverage: 1.0, materialEventBlock: false },
  PVD: { verified: true, status: 'ACTIVE', qualityScore: 74, qualityCoverage: 1.0, materialEventBlock: false },
  PVS: { verified: true, status: 'ACTIVE', qualityScore: 78, qualityCoverage: 1.0, materialEventBlock: false },
  VIC: { verified: true, status: 'ACTIVE', qualityScore: 72, qualityCoverage: 1.0, materialEventBlock: false },
  VHM: { verified: true, status: 'ACTIVE', qualityScore: 78, qualityCoverage: 1.0, materialEventBlock: false },
  VRE: { verified: true, status: 'ACTIVE', qualityScore: 77, qualityCoverage: 1.0, materialEventBlock: false },
  KDH: { verified: true, status: 'ACTIVE', qualityScore: 79, qualityCoverage: 1.0, materialEventBlock: false },
  NLG: { verified: true, status: 'ACTIVE', qualityScore: 78, qualityCoverage: 1.0, materialEventBlock: false },
  GMD: { verified: true, status: 'ACTIVE', qualityScore: 84, qualityCoverage: 1.0, materialEventBlock: false },
  HAH: { verified: true, status: 'ACTIVE', qualityScore: 79, qualityCoverage: 1.0, materialEventBlock: false },
  DGC: { verified: true, status: 'ACTIVE', qualityScore: 88, qualityCoverage: 1.0, materialEventBlock: false },
  DPM: { verified: true, status: 'ACTIVE', qualityScore: 78, qualityCoverage: 1.0, materialEventBlock: false },
  DCM: { verified: true, status: 'ACTIVE', qualityScore: 79, qualityCoverage: 1.0, materialEventBlock: false },
  REE: { verified: true, status: 'ACTIVE', qualityScore: 84, qualityCoverage: 1.0, materialEventBlock: false },
  VNM: { verified: true, status: 'ACTIVE', qualityScore: 86, qualityCoverage: 1.0, materialEventBlock: false },
  MSN: { verified: true, status: 'ACTIVE', qualityScore: 74, qualityCoverage: 1.0, materialEventBlock: false },
  SAB: { verified: true, status: 'ACTIVE', qualityScore: 82, qualityCoverage: 1.0, materialEventBlock: false },
  // Một số mã có rủi ro nợ/cảnh báo/đình trệ cần theo dõi chặt
  HBC: { verified: true, status: 'WARNING', qualityScore: 35, qualityCoverage: 1.0, materialEventBlock: true },
  NVL: { verified: true, status: 'ACTIVE', qualityScore: 45, qualityCoverage: 1.0, materialEventBlock: false },
};

function getQualityProfile(symbol) {
  return QUALITY_PROFILES[symbol] || {
    verified: false,
    status: 'ACTIVE',
    qualityScore: null,
    qualityCoverage: 0,
    materialEventBlock: false,
  };
}

module.exports = { QUALITY_PROFILES, getQualityProfile };
