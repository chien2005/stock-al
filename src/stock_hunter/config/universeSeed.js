/**
 * AI STOCK HUNTER - Seed Universe (131 mã thuộc 16 nhóm ngành vận hành)
 * Lưu ý: Đây là tập hạt giống khởi tạo. Từng mã phải đi qua Universe Hard Gates
 * (status, thanh khoản 20 phiên >= 20 tỷ, lịch sử nến, quality coverage) trước khi đủ điều kiện BUY.
 */

const SEED_GROUPS = [
  {
    sector: 'Ngân hàng',
    sectorCode: 'BANK',
    riskCluster: 'FINANCE_CREDIT',
    exchangeDefault: 'HOSE',
    symbols: ['VCB', 'BID', 'CTG', 'TCB', 'MBB', 'VPB', 'ACB', 'STB', 'HDB', 'VIB', 'TPB', 'SHB', 'LPB', 'OCB', 'MSB', 'EIB', 'SSB', 'NAB', 'BAB', 'BVB'],
  },
  {
    sector: 'Chứng khoán',
    sectorCode: 'SECURITIES',
    riskCluster: 'FINANCE_CREDIT',
    exchangeDefault: 'HOSE',
    symbols: ['SSI', 'VND', 'VCI', 'HCM', 'SHS', 'MBS', 'FTS', 'BSI', 'CTS', 'VDS', 'ORS', 'VIX', 'TVS'],
  },
  {
    sector: 'Bảo hiểm',
    sectorCode: 'INSURANCE',
    riskCluster: 'FINANCE_DEFENSIVE',
    exchangeDefault: 'HOSE',
    symbols: ['BVH', 'PVI', 'BMI', 'MIG'],
  },
  {
    sector: 'BĐS nhà ở / thương mại',
    sectorCode: 'REAL_ESTATE',
    riskCluster: 'REAL_ESTATE_CYCLE',
    exchangeDefault: 'HOSE',
    symbols: ['VIC', 'VHM', 'VRE', 'KDH', 'NLG', 'DXG', 'PDR', 'DIG', 'NVL', 'HDG', 'CEO', 'HDC', 'TCH'],
  },
  {
    sector: 'BĐS khu công nghiệp',
    sectorCode: 'INDUSTRIAL_RE',
    riskCluster: 'INDUSTRIAL_FDI',
    exchangeDefault: 'HOSE',
    symbols: ['BCM', 'KBC', 'IDC', 'SZC', 'SIP', 'VGC', 'LHG', 'NTC', 'TIP', 'D2D'],
  },
  {
    sector: 'Thực phẩm / Tiêu dùng thiết yếu',
    sectorCode: 'CONSUMER_STAPLES',
    riskCluster: 'CONSUMER_DOMESTIC',
    exchangeDefault: 'HOSE',
    symbols: ['VNM', 'MSN', 'SAB', 'QNS', 'SBT', 'KDC', 'DBC', 'MCH', 'PAN', 'VHC', 'ANV', 'FMC'],
  },
  {
    sector: 'Bán lẻ / Tiêu dùng không thiết yếu',
    sectorCode: 'RETAIL',
    riskCluster: 'CONSUMER_DOMESTIC',
    exchangeDefault: 'HOSE',
    symbols: ['MWG', 'FRT', 'PNJ', 'DGW', 'PET', 'HAX'],
  },
  {
    sector: 'Công nghệ / Viễn thông',
    sectorCode: 'TECH',
    riskCluster: 'TECH_GROWTH',
    exchangeDefault: 'HOSE',
    symbols: ['FPT', 'CMG', 'CTR', 'VGI', 'FOX', 'ELC'],
  },
  {
    sector: 'Dầu khí / Nhiên liệu',
    sectorCode: 'OIL_GAS',
    riskCluster: 'ENERGY_COMMODITY',
    exchangeDefault: 'HOSE',
    symbols: ['GAS', 'PLX', 'PVD', 'PVS', 'BSR', 'PVT', 'PVB', 'PVC'],
  },
  {
    sector: 'Cảng biển / Logistics',
    sectorCode: 'SEAPORT',
    riskCluster: 'EXPORT_LOGISTICS',
    exchangeDefault: 'HOSE',
    symbols: ['GMD', 'HAH', 'VSC', 'SGP', 'VOS', 'VTO', 'SCS'],
  },
  {
    sector: 'Thép / Vật liệu',
    sectorCode: 'STEEL_MAT',
    riskCluster: 'MATERIALS_CYCLE',
    exchangeDefault: 'HOSE',
    symbols: ['HPG', 'HSG', 'NKG', 'VGS', 'HT1', 'BCC', 'BMP'],
  },
  {
    sector: 'Hạ tầng / Xây dựng',
    sectorCode: 'INFRASTRUCTURE',
    riskCluster: 'PUBLIC_INVESTMENT',
    exchangeDefault: 'HOSE',
    symbols: ['CII', 'HHV', 'VCG', 'FCN', 'CTD', 'HBC', 'PC1'],
  },
  {
    sector: 'Điện / Nước',
    sectorCode: 'UTILITIES',
    riskCluster: 'UTILITIES_DEFENSIVE',
    exchangeDefault: 'HOSE',
    symbols: ['POW', 'NT2', 'REE', 'GEG', 'QTP', 'BWE', 'TDM'],
  },
  {
    sector: 'Hóa chất / Phân bón / Cao su',
    sectorCode: 'CHEMICALS',
    riskCluster: 'MATERIALS_CYCLE',
    exchangeDefault: 'HOSE',
    symbols: ['DGC', 'DPM', 'DCM', 'GVR', 'PHR'],
  },
  {
    sector: 'Dược / Y tế',
    sectorCode: 'HEALTHCARE',
    riskCluster: 'UTILITIES_DEFENSIVE',
    exchangeDefault: 'HOSE',
    symbols: ['DHG', 'IMP', 'DBD'],
  },
  {
    sector: 'Hàng không / Du lịch',
    sectorCode: 'AVIATION_TRAVEL',
    riskCluster: 'TRAVEL_SERVICES',
    exchangeDefault: 'HOSE',
    symbols: ['HVN', 'VJC', 'VPL'],
  },
];

// Ghi đè sàn giao dịch cụ thể cho các mã HNX/UPCoM trong seed (để Calendar & TickRules áp đúng quy chuẩn)
const EXCHANGE_OVERRIDES = {
  SHS: 'HNX', MBS: 'HNX', CEO: 'HNX', IDC: 'HNX', PVS: 'HNX', PVB: 'HNX', PVC: 'HNX',
  VGS: 'HNX', BCC: 'HNX', BAB: 'HNX', BVB: 'HNX',
  MCH: 'UPCOM', QNS: 'UPCOM', VGI: 'UPCOM', FOX: 'UPCOM', QTP: 'UPCOM', SGP: 'UPCOM',
  // BSR đã chuyển sang HOSE năm 2025; giữ metadata rõ ràng để adapter đối chiếu security master
};

// Nhãn risk cluster riêng cho các hệ sinh thái có tương quan chéo cao
const CLUSTER_OVERRIDES = {
  VIC: 'VINGROUP_ECOSYSTEM',
  VHM: 'VINGROUP_ECOSYSTEM',
  VRE: 'VINGROUP_ECOSYSTEM',
  VPL: 'VINGROUP_ECOSYSTEM',
  GVR: 'INDUSTRIAL_FDI',
  PHR: 'INDUSTRIAL_FDI',
  DGC: 'TECH_CHEMICAL_EXPORT',
};

function buildSeedInstruments() {
  const map = new Map();
  for (const group of SEED_GROUPS) {
    for (const symbol of group.symbols) {
      map.set(symbol, {
        symbol,
        sector: group.sector,
        sectorCode: group.sectorCode,
        exchange: EXCHANGE_OVERRIDES[symbol] || group.exchangeDefault,
        riskCluster: CLUSTER_OVERRIDES[symbol] || group.riskCluster,
        isSeed: true,
      });
    }
  }
  return Array.from(map.values());
}

const SEED_INSTRUMENTS = buildSeedInstruments();
const SEED_MAP = new Map(SEED_INSTRUMENTS.map(item => [item.symbol, item]));

function getInstrumentMeta(symbol) {
  return SEED_MAP.get(symbol) || {
    symbol,
    sector: 'Khác',
    sectorCode: 'OTHER',
    exchange: EXCHANGE_OVERRIDES[symbol] || 'HOSE',
    riskCluster: CLUSTER_OVERRIDES[symbol] || 'OTHER',
    isSeed: false,
  };
}

module.exports = {
  SEED_GROUPS,
  SEED_INSTRUMENTS,
  SEED_MAP,
  EXCHANGE_OVERRIDES,
  getInstrumentMeta,
};
