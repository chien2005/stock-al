#!/bin/bash
# ╔═══════════════════════════════════════════════════════════╗
# ║   🔄 VN Stock Bot — Pull code mới & restart              ║
# ╚═══════════════════════════════════════════════════════════╝

cd /home/ubuntu/vn-stock-bot

echo "📥 Pull code mới từ GitHub..."
git pull origin main

echo "📦 Cập nhật dependencies..."
npm install --production

echo "🔄 Restart bot..."
pm2 restart vn-stock-bot

echo ""
echo "✅ Đã cập nhật và restart! Xem logs:"
echo "   pm2 logs vn-stock-bot --lines 30"
echo ""

pm2 list
