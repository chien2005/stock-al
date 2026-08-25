module.exports = {
  apps: [{
    name: 'vn-stock-bot',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '800M',
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Ho_Chi_Minh',
    },
    // Tự khởi động lại nếu crash
    restart_delay: 5000,
    max_restarts: 50,
    min_uptime: '10s',
    // Log
    log_date_format: 'DD/MM/YYYY HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    merge_logs: true,
  }],
};
