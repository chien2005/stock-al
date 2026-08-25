#!/bin/bash
# ╔═══════════════════════════════════════════════════════════╗
# ║   🟢 VN Stock Bot — Start / Restart with PM2             ║
# ╚═══════════════════════════════════════════════════════════╝

cd /home/ubuntu/vn-stock-bot

echo "🔄 Khởi động VN Stock Bot với PM2..."

# Stop nếu đang chạy
pm2 stop vn-stock-bot 2>/dev/null || true
pm2 delete vn-stock-bot 2>/dev/null || true

# Start với ecosystem config
pm2 start ecosystem.config.js

# Lưu PM2 process list (tự khởi động khi reboot VM)
pm2 save

# Setup PM2 auto-start khi reboot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
pm2 save

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ✅ BOT ĐÃ KHỞI ĐỘNG!                                  ║"
echo "║                                                           ║"
echo "║   📊 Xem logs:    pm2 logs vn-stock-bot                  ║"
echo "║   📈 Xem status:  pm2 monit                              ║"
echo "║   🔄 Restart:     pm2 restart vn-stock-bot               ║"
echo "║   🛑 Stop:        pm2 stop vn-stock-bot                  ║"
echo "║   📋 Danh sách:   pm2 list                               ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

pm2 list
