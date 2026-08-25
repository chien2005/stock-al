#!/bin/bash
# ╔═══════════════════════════════════════════════════════════╗
# ║   🚀 VN Stock Bot — Oracle Cloud Setup Script            ║
# ║   Chạy script này sau khi SSH vào VM Oracle              ║
# ╚═══════════════════════════════════════════════════════════╝

set -e

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   🚀 VN Stock Bot — Oracle Cloud Auto Setup              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# 1. Update hệ thống
echo "📦 [1/7] Cập nhật hệ thống..."
sudo apt-get update -y && sudo apt-get upgrade -y

# 2. Cài Node.js 20 LTS
echo "📦 [2/7] Cài Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "   ✅ Node.js $(node -v) | npm $(npm -v)"

# 3. Cài PM2 (process manager chạy 24/7)
echo "📦 [3/7] Cài PM2 (Process Manager)..."
sudo npm install -g pm2

# 4. Cài Git
echo "📦 [4/7] Cài Git..."
sudo apt-get install -y git

# 5. Clone project
echo "📦 [5/7] Clone project từ GitHub..."
cd /home/ubuntu
if [ -d "vn-stock-bot" ]; then
  echo "   ⚠️  Thư mục đã tồn tại, pull code mới nhất..."
  cd vn-stock-bot
  git pull origin main
else
  git clone https://github.com/chienal2005/vn-stock-bot.git
  cd vn-stock-bot
fi

# 6. Cài dependencies
echo "📦 [6/7] Cài npm dependencies..."
npm install --production

# Tạo thư mục logs và data
mkdir -p logs data

# 7. Tạo file .env
echo "📦 [7/7] Kiểm tra .env..."
if [ ! -f ".env" ]; then
  echo ""
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║   ⚠️  CẦN TẠO FILE .env                                 ║"
  echo "║   Chạy lệnh: nano /home/ubuntu/vn-stock-bot/.env        ║"
  echo "║   Rồi paste nội dung .env từ máy local vào              ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo ""
  echo "Sau khi tạo .env xong, chạy tiếp: bash deploy/start.sh"
else
  echo "   ✅ File .env đã tồn tại"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ✅ SETUP HOÀN TẤT!                                     ║"
echo "║                                                           ║"
echo "║   Bước tiếp theo:                                        ║"
echo "║   1. Tạo file .env (nếu chưa có)                        ║"
echo "║   2. Chạy: bash deploy/start.sh                          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
