const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

(async () => {
  try {
    const qs = require('querystring');
    const postData = qs.stringify({
      pNumPage: 1,
      pAction: 1,
      pNhomTin: 'PS_TIN_GD',
      pTieuDeTin: '',
      pFromDate: '',
      pToDate: '',
      pOrderBy: '',
      pNumRecord: 20
    });

    const res = await axios.post('https://hnx.vn/ModulePhaiSinh/PhaiSinhThongTinCongBo/NextPageTinPhaiSinh', postData, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      httpsAgent: agent
    });
    console.log('Result length:', res.data.length);
    // Extract titles and dates
    const re = /<tr[\s\S]*?<\/tr>/gi;
    let m;
    while ((m = re.exec(res.data)) !== null) {
      console.log('--- Row ---');
      console.log(m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }
  } catch (e) {
    console.error(e.message);
  }
})();
