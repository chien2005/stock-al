const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

async function testGeminiKey(keyName, keyVal) {
  if (!keyVal) {
    console.log(`❌ ${keyName}: Không cấu hình (trống)`);
    return false;
  }
  try {
    const genAI = new GoogleGenerativeAI(keyVal);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const response = await model.generateContent('Hello');
    console.log(`✅ ${keyName}: Hoạt động tốt! Phản hồi: "${response.response.text().trim().substring(0, 30)}..."`);
    return true;
  } catch (error) {
    console.log(`❌ ${keyName}: Lỗi - ${error.message}`);
    return false;
  }
}

async function testVpsApi() {
  try {
    const res = await axios.get('https://bgapidatafeed.vps.com.vn/getliststockdata/VCB', { timeout: 5000 });
    if (res.data && res.data.length > 0) {
      console.log(`✅ VPS Realtime API: Hoạt động tốt! Đã lấy được mã VCB.`);
      return true;
    } else {
      console.log(`❌ VPS Realtime API: API trả về dữ liệu rỗng.`);
      return false;
    }
  } catch (error) {
    console.log(`❌ VPS Realtime API: Lỗi - ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('=== HỆ THỐNG KIỂM TRA ĐƯỜNG TRUYỀN & API KEY ===\n');
  
  console.log('1. Kiểm tra VPS Realtime Stock API:');
  await testVpsApi();
  console.log('');

  console.log('2. Kiểm tra các Google Gemini API Key trong file .env:');
  await testGeminiKey('GEMINI_API_KEY_AI1', process.env.GEMINI_API_KEY_AI1);
  await testGeminiKey('GEMINI_API_KEY_AI2', process.env.GEMINI_API_KEY_AI2);
  await testGeminiKey('GEMINI_API_KEY_AI3', process.env.GEMINI_API_KEY_AI3);
  await testGeminiKey('GEMINI_API_KEY_AI4', process.env.GEMINI_API_KEY_AI4);
  console.log('');

  console.log('3. Kiểm tra OpenRouter API Key:');
  if (process.env.OPENROUTER_API_KEY) {
    console.log('OpenRouter Key được cấu hình, đang kiểm tra...');
  } else {
    console.log('❌ OPENROUTER_API_KEY: Không cấu hình (trống) -> Đang fallback về Gemini');
  }
}

main();
