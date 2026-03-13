# 🇻🇳 VN Stock Tracker & Telegram Notifier

Hệ thống tự động lấy dữ liệu chứng khoán Việt Nam realtime và gửi báo cáo về Telegram.

## ✨ Tính năng

- 📊 Lấy dữ liệu **10 mã cổ phiếu** phổ biến nhất (tùy chỉnh được)
- 💰 Giá realtime: giá hiện tại, giá tham chiếu, trần, sàn, OHLC
- 📦 Khối lượng giao dịch + so sánh với trung bình 20 phiên
- 💚💔 Khối ngoại: mua, bán, ròng
- 📋 Chỉ số kỹ thuật: SMA20
- 📖 Sổ lệnh: Best bid/ask
- ⏰ Tự động chạy lúc **10:00, 13:00, 16:00** hằng ngày
- 📩 Gửi báo cáo đẹp về **Telegram Bot**

## 🚀 Cài đặt & Chạy

### 1. Cài dependencies
```bash
npm install
```

### 2. Cấu hình `.env`
```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Mã cổ phiếu (phân cách bằng dấu phẩy)
STOCK_SYMBOLS=VNM,FPT,VIC,HPG,MWG,MSN,VHM,TCB,VPB,MBB

# Lịch chạy (cron format)
CRON_SCHEDULE=0 10,13,16 * * *

# Timezone
TZ=Asia/Ho_Chi_Minh
```

### 3. Chạy

```bash
# Chạy bot (auto schedule 10h, 13h, 16h)
npm start

# Chạy test 1 lần ngay (gửi Telegram)
npm run fetch

# Test toàn bộ modules
npm test
```

## 📁 Cấu trúc Project

```
vn-stock-telegram-bot/
├── 📄 package.json
├── 📄 .env                  # Cấu hình (Telegram, mã CK, schedule)
├── 📄 .gitignore
├── 📄 README.md
└── 📂 src/
    ├── 📄 index.js           # Entry point - khởi động bot + cron
    ├── 📄 config.js          # Đọc cấu hình từ .env
    ├── 📄 stockService.js    # Lấy dữ liệu CK từ VPS API
    ├── 📄 telegramService.js # Format + gửi message Telegram
    ├── 📄 fetchNow.js        # Script chạy 1 lần (test)
    └── 📄 test.js            # Test script
```

## 📡 Nguồn dữ liệu

- **VPS (VPBank Securities)** - `bgapidatafeed.vps.com.vn`
  - Dữ liệu realtime: giá, KL, khối ngoại, sổ lệnh
  - API công khai, không cần đăng ký
- **VPS History** - `histdatafeed.vps.com.vn`
  - Dữ liệu lịch sử giá (TradingView format)
  - Dùng để tính KLTB 20 phiên, SMA20

## 📊 Các lệnh NPM

| Lệnh            | Mô tả                                        |
|-----------------|-----------------------------------------------|
| `npm start`     | Chạy bot với auto schedule (10h, 13h, 16h)    |
| `npm run fetch` | Chạy 1 lần ngay, gửi báo cáo lên Telegram    |
| `npm test`      | Test toàn bộ: config, API, Telegram           |
| `npm run dev`   | Chạy dev mode (auto restart khi sửa code)     |

## 🔧 Tùy chỉnh

### Thay đổi mã cổ phiếu
Sửa `STOCK_SYMBOLS` trong `.env`:
```env
STOCK_SYMBOLS=VNM,FPT,VIC,HPG,MWG,MSN,VHM,TCB,VPB,MBB
```

### Thay đổi lịch chạy
Sửa `CRON_SCHEDULE` trong `.env` (cron format):
```env
# Mỗi 30 phút trong giờ giao dịch (9h-15h)
CRON_SCHEDULE=*/30 9-15 * * 1-5

# 3 lần/ngày (mặc định)
CRON_SCHEDULE=0 10,13,16 * * *

# Mỗi giờ
CRON_SCHEDULE=0 * * * *
```

## 📝 Lưu ý

- Dữ liệu từ VPS API là **miễn phí** và công khai
- Bot chỉ chạy khi process đang active (dùng PM2 để chạy nền)
- Telegram Bot Token lấy từ [@BotFather](https://t.me/BotFather)
- Chat ID lấy từ [@userinfobot](https://t.me/userinfobot)

## 🚀 Chạy nền với PM2 (khuyên dùng)

```bash
# Cài PM2
npm install -g pm2

# Chạy bot nền
pm2 start src/index.js --name "vn-stock-bot"

# Xem log
pm2 logs vn-stock-bot

# Tự khởi động khi restart máy
pm2 startup
pm2 save
```
