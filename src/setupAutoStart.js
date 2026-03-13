/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║     🔧 SETUP AUTO-START cho Windows                      ║
 * ╠═══════════════════════════════════════════════════════════╣
 * ║  Tạo shortcut trong Windows Startup folder               ║
 * ║  → Bot tự chạy nền mỗi khi bật máy                      ║
 * ╚═══════════════════════════════════════════════════════════╝
 * 
 * Usage: npm run setup
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
const VBS_FILE = path.join(PROJECT_DIR, 'start-bot-silent.vbs');

async function setup() {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║   🔧 SETUP TỰ ĐỘNG CHẠY KHI BẬT MÁY WINDOWS   ║
  ╚═══════════════════════════════════════════════════╝
  `);

  console.log('📁 Project:', PROJECT_DIR);
  console.log('📄 VBS Launcher:', VBS_FILE);
  console.log('');

  // Kiểm tra file VBS tồn tại
  if (!fs.existsSync(VBS_FILE)) {
    console.error('❌ Không tìm thấy start-bot-silent.vbs!');
    process.exit(1);
  }

  // ─── OPTION 1: Shortcut vào Windows Startup ─────────

  console.log('─── Option 1: Windows Startup Folder ───');
  
  try {
    // Lấy đường dẫn Startup folder
    const startupFolder = path.join(
      process.env.APPDATA,
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
    );

    console.log(`   📂 Startup folder: ${startupFolder}`);

    // Tạo shortcut bằng PowerShell
    const shortcutPath = path.join(startupFolder, 'VNStockBot.lnk');
    
    const psCommand = `
      $ws = New-Object -ComObject WScript.Shell;
      $sc = $ws.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\')}');
      $sc.TargetPath = '${VBS_FILE.replace(/\\/g, '\\\\')}';
      $sc.WorkingDirectory = '${PROJECT_DIR.replace(/\\/g, '\\\\')}';
      $sc.Description = 'VN Stock Tracker - Telegram Bot';
      $sc.Save()
    `.replace(/\n/g, ' ');

    execSync(`powershell -Command "${psCommand}"`, { stdio: 'pipe' });
    console.log(`   ✅ Đã tạo shortcut: ${shortcutPath}`);
    console.log('   📌 Bot sẽ TỰ ĐỘNG chạy nền mỗi khi bật máy!');

  } catch (error) {
    console.error('   ❌ Lỗi tạo shortcut:', error.message);
    console.log('   💡 Bạn có thể tạo thủ công:');
    console.log(`      1. Mở Run (Win+R) → gõ: shell:startup`);
    console.log(`      2. Copy file "start-bot-silent.vbs" vào thư mục đó`);
  }

  // ─── OPTION 2: Windows Task Scheduler ───────────────

  console.log('\n─── Option 2: Task Scheduler (backup) ───');

  try {
    const taskName = 'VNStockBot';
    
    // Xóa task cũ nếu có
    try {
      execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'pipe' });
    } catch (e) { /* task chưa tồn tại */ }

    // Tạo task mới - chạy khi đăng nhập
    const createCmd = `schtasks /create /tn "${taskName}" /tr "wscript.exe \\"${VBS_FILE}\\"" /sc ONLOGON /rl HIGHEST /f`;
    execSync(createCmd, { stdio: 'pipe' });
    
    console.log(`   ✅ Đã tạo Task: ${taskName}`);
    console.log('   📌 Bot sẽ chạy mỗi khi đăng nhập Windows');

  } catch (error) {
    console.error('   ❌ Lỗi Task Scheduler:', error.message);
    console.log('   💡 Cần chạy CMD/PowerShell với quyền Admin');
  }

  // ─── HƯỚNG DẪN THỦ CÔNG ────────────────────────────

  console.log('\n' + '═'.repeat(55));
  console.log('📋 HƯỚNG DẪN CHẠY THỦ CÔNG (nếu auto-setup lỗi):');
  console.log('═'.repeat(55));
  console.log('');
  console.log('🔹 Cách 1: Double-click file');
  console.log(`   → ${path.join(PROJECT_DIR, 'start-bot.bat')} (có cửa sổ CMD)`);
  console.log(`   → ${VBS_FILE} (chạy ẩn, không cửa sổ)`);
  console.log('');
  console.log('🔹 Cách 2: Windows Startup (tự chạy khi bật máy)');
  console.log('   1. Nhấn Win+R → gõ: shell:startup → Enter');
  console.log(`   2. Copy file "start-bot-silent.vbs" vào folder đó`);
  console.log('');
  console.log('🔹 Cách 3: PM2 (pro - khuyên dùng)');
  console.log('   npm install -g pm2');
  console.log(`   pm2 start ${path.join(PROJECT_DIR, 'src', 'index.js')} --name vn-stock-bot`);
  console.log('   pm2 save');
  console.log('   pm2-startup install  (tự chạy khi boot)');
  console.log('');
  console.log('🔹 Cách 4: Dừng bot đang chạy nền');
  console.log('   → Mở Task Manager → tìm process "node" → End task');
  console.log('   → Hoặc chạy: taskkill /f /im node.exe');
  console.log('');
  console.log('═'.repeat(55));
  console.log('✅ SETUP HOÀN TẤT!');
  console.log('═'.repeat(55));
}

setup().catch(err => {
  console.error('💥 Setup error:', err);
  process.exit(1);
});
