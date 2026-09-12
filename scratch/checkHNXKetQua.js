const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

(async () => {
  const res = await axios.get('https://hnx.vn/vi-vn/phai-sinh/ket-qua-giao-dich.html', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    httpsAgent: agent
  });
  const text = res.data;
  const qs = require('querystring');
  const postData = qs.stringify({
    p_date: '19/08/2026',
    p_keysearch: '',
    p_orderby: '',
    p_ordertype: '',
    p_currentpage: 1,
    p_type_sanpham: 'HDTL_VN30',
    p_record_on_page: 20
  });

  const res2 = await axios.post('https://hnx.vn/ModulePhaiSinh/KetQuaGiaoDichV2/ListSearch_Datas', postData, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    },
    httpsAgent: agent
  });
  console.log('Result type:', typeof res2.data);
  const htmlContent = res2.data.Content || '';
  const rows = htmlContent.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  console.log('Rows count:', rows.length);
  for (const r of rows) {
    const text = r.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('Row:', text);
  }
})();
