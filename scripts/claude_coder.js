/**
 * Claude Coder CLI (Powered by Claude Opus 5.5 / MiraiAPI)
 * Usage:
 *   node scripts/claude_coder.js "Viết cho tôi hàm tính MACD bằng JavaScript"
 *   hoặc chạy không tham số để mở chế độ nhập trực tiếp:
 *   node scripts/claude_coder.js
 */

require('dotenv').config();
const OpenAI = require('openai');
const readline = require('readline');

const apiKey = process.env.CLAUDE_API_KEY;
const baseURL = process.env.CLAUDE_BASE_URL || 'https://api.miraiapi.com/v1';
const model = process.env.CLAUDE_MODEL || 'ccmax-claude-opus-5.5';

if (!apiKey) {
  console.error('❌ Chưa cấu hình CLAUDE_API_KEY trong file .env');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: apiKey,
  baseURL: baseURL,
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
  }
});

async function askClaude(prompt) {
  console.log(`\n⏳ Đang gửi yêu cầu tới Claude Opus 5.5 (${model})...\n`);
  try {
    const stream = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: 'Bạn là Senior Software Engineer chuyên sâu về Node.js, Python và Financial Tech. Hãy viết code tối ưu, chuẩn sạch, có giải thích súc tích bằng tiếng Việt.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      stream: true,
      temperature: 0.2
    });

    process.stdout.write('🤖 [Claude Opus 5.5]:\n\n');
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      process.stdout.write(content);
    }
    console.log('\n\n✅ Hoàn thành.');
  } catch (error) {
    console.error('\n❌ Lỗi khi gọi Claude:', error.response?.data || error.message);
  }
}

// Chạy trực tiếp
const promptArg = process.argv.slice(2).join(' ').trim();
if (promptArg) {
  askClaude(promptArg);
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Nhập yêu cầu code bạn muốn Claude thực hiện: ', (answer) => {
    rl.close();
    if (answer.trim()) {
      askClaude(answer.trim());
    } else {
      console.log('Bạn chưa nhập nội dung.');
    }
  });
}
