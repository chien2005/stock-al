' VN Stock Bot - Silent Launcher
' Chạy bot ẩn không hiện cửa sổ CMD
' Double-click file này hoặc đặt vào Windows Startup

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Lấy đường dẫn thư mục hiện tại
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Chạy bot ẩn (0 = hidden, false = no wait)
WshShell.Run "cmd /c cd /d """ & scriptDir & """ && node src/index.js > bot.log 2>&1", 0, False
