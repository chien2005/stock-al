/**
 * 🧪 TEST: Gửi 1 tin OI Evening Notification lên Telegram
 * Dùng data đã sửa (11/9 ΔOI = -1549)
 * Chạy: node scratch/testSendOINotification.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { config } = require('../src/config');
const oiTracker = require('../src/derivatives/oiTracker');
const { sendDerivativesMessage } = require('../src/telegramService');

async function main() {
  console.log('🧪 TEST: Gửi OI Evening Notification lên Telegram');
  console.log('═'.repeat(60));

  // Build notification (sync version, dùng data từ file)
  console.log('\n📝 Building notification message...');
  const msg = oiTracker.buildOIEveningNotificationSync('evening');

  if (!msg || msg.includes('Chưa có đủ dữ liệu')) {
    console.error('❌ Không build được message:', msg);
    return;
  }

  // Preview (strip HTML tags)
  console.log('\n📱 PREVIEW (stripped HTML):');
  console.log('─'.repeat(60));
  const cleanMsg = msg
    .replace(/<b>/g, '**').replace(/<\/b>/g, '**')
    .replace(/<i>/g, '_').replace(/<\/i>/g, '_')
    .replace(/<code>/g, '`').replace(/<\/code>/g, '`')
    .replace(/<pre>/g, '```').replace(/<\/pre>/g, '```')
    .replace(/\\n/g, '\n');
  console.log(cleanMsg);
  console.log('─'.repeat(60));

  // Send to Telegram
  console.log('\n📩 Sending to Telegram...');
  const chatId = config.telegram.chatIdDerivatives || config.telegram.chatId;
  console.log(`   Chat ID: ${chatId}`);
  console.log(`   Bot Token: ${config.telegram.botToken ? '✅ Configured' : '❌ Missing'}`);

  if (!config.telegram.botToken || !chatId) {
    console.error('❌ Missing Telegram config! Check .env');
    return;
  }

  const success = await sendDerivativesMessage(msg);
  if (success) {
    console.log('✅ Đã gửi thành công lên Telegram!');
  } else {
    console.log('❌ Gửi thất bại!');
  }

  console.log('\n' + '═'.repeat(60));
}

main().catch(e => console.error('Fatal:', e));
