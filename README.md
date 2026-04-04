# 🇻🇳 VN Stock Bot v1.1.1

> **Multi-AI Team System** - Bot theo dõi chứng khoán Việt Nam với 4 AI chuyên gia

## 🏢 Kiến trúc AI Team

```
🤖 AI 1: Bot Thông Báo     (Gemini 2.5 Pro)  - Scheduled reports
📊 AI 2: Chuyên gia Gemini  (Gemini 2.5 Pro)  - Phân tích kỹ thuật + cơ bản
💬 AI 3: Chuyên gia GPT     (GPT-4o-mini)     - Phân tích góc nhìn khác
⚔️ AI 4: AI Phản biện       (Gemini 2.5 Flash) - Phản biện, chỉ ra rủi ro ẩn
```

### Flow tương tác:
```
User gửi tin nhắn
    ├── 📊 AI 2 (Gemini) ──→ Phân tích → Gửi Telegram
    └── 💬 AI 3 (GPT) ──→ Phân tích → Gửi Telegram
                ↓
    ⚔️ AI 4 (Phản biện) ← Tổng hợp cả 2 kết quả
                ↓
    Kết luận cuối cùng → Gửi Telegram
```

## ⏰ Lịch thông báo

| Thời gian | Job | Mô tả |
|-----------|-----|-------|
| 10:00, 13:00, 16:00 (T2-T6) | 📊 Báo giá | Bảng giá 12 mã CP |
| 20:30 (T2-T6) | 🤖 AI Report | Phân tích đa chuyên gia cuối ngày |
| 8:30 (Thứ 2) | 📅 Weekly | Phân tích tình hình đầu tuần |
| 24/7 | 💬 Interactive | Chat hỏi AI bất cứ lúc nào |

## 🐛 Bug Fixes (v1.1.1)

- ✅ **Fix noti dư thừa 7-8h sáng**: Bỏ chạy job khi khởi động, thêm runtime weekday guard
- ✅ **Fix double message**: Thêm dedup lock 4 phút chống trigger trùng
- ✅ **Fix T7/CN vẫn bắn noti**: Runtime `isWeekday()` check bổ sung cho cron

## 🚀 Setup

### 1. Clone & Install

```bash
git clone https://github.com/your-repo/vn-stock-bot.git
cd vn-stock-bot
npm install
```

### 2. Cấu hình .env

```bash
cp .env.example .env
```

Cần tối thiểu:
- `TELEGRAM_BOT_TOKEN` - Lấy từ [@BotFather](https://t.me/BotFather)
- `TELEGRAM_CHAT_ID` - ID chat/group
- `GEMINI_API_KEY` - Free từ [AI Studio](https://aistudio.google.com/apikey)
- `OPENAI_API_KEY` - Từ [OpenAI](https://platform.openai.com/api-keys) (cho AI 3)

### 3. Chạy

```bash
# Development (auto-reload)
npm run dev

# Production
npm start

# Test
npm test
```

### 4. Deploy lên Railway

```bash
# Push code lên GitHub → Railway auto deploy
git add .
git commit -m "v1.1.1: Multi-AI Team System"
git push
```

## 💬 Telegram Commands

| Command | Mô tả |
|---------|-------|
| `/gia VCB` | Xem giá cổ phiếu |
| `/gia VCB,FPT,MWG` | Xem nhiều mã |
| `/phantich MWG` | AI Team phân tích CP |
| `/tuanmoi` | Phân tích đầu tuần |
| `/team` | Xem đội ngũ AI |
| `/help` | Trợ giúp |
| Chat tự do | AI Team trả lời |

## 📁 Project Structure

```
src/
├── index.js           # Main entry + cron schedules + bug fixes
├── config.js          # Configuration & validation
├── stockService.js    # VPS API data fetching
├── telegramService.js # Telegram message sending + formatting
├── aiTeam.js          # Multi-AI Team (AI 1-4) engine
├── weeklyAnalysis.js  # Weekly market analysis (Monday 8:30)
├── botHandler.js      # Interactive Telegram bot handler
├── test.js            # Test suite
├── analyzeNow.js      # Quick AI analysis
└── fetchNow.js        # Quick stock fetch
```

## 📊 Data Source

- **VPS (VPBank Securities)** Public API
- Realtime: `bgapidatafeed.vps.com.vn`
- History: `histdatafeed.vps.com.vn`

## 📝 Changelog

### v1.1.1 (2026-04-04)
- 🐛 Fix noti dư thừa khi server restart
- 🐛 Fix double message mỗi khung giờ
- 🐛 Fix T7/CN vẫn bắn noti
- 🆕 Multi-AI Team: 4 AI chuyên gia (Gemini + GPT + Phản biện)
- 🆕 Weekly Analysis: Phân tích đầu tuần (T2, 8h30)
- 🆕 Interactive Bot: Chat hỏi AI trong Telegram
- ⬆️ Upgrade Gemini 2.5 Flash → Gemini 2.5 Pro
- ⬆️ Thêm OpenAI GPT-4o-mini

### v1.0.0
- Initial release
- Báo giá 10h, 13h, 16h
- AI Report 20h30
