@echo off
rem ===========================================================
rem  Echo Clock ^& Weather - ローカルプレビュー起動
rem  このバッチを実行すると簡易サーバーが立ち上がり、
rem  同じ Wi-Fi 上の Echo Show 5 からも表示できます。
rem ===========================================================
setlocal
cd /d "%~dp0"
set PORT=8765

echo.
echo  Echo Clock ^& Weather を起動します（ポート %PORT%）
echo  ---------------------------------------------------
echo   このPC  : http://localhost:%PORT%/
echo.
echo   Echo Show 5 からは、下に表示される IPv4 アドレスを使って
echo   http://[IPv4アドレス]:%PORT%/ を開いてください。
echo.
ipconfig | findstr /C:"IPv4"
echo  ---------------------------------------------------
echo   終了するには、この画面で Ctrl + C を押してください。
echo.

python -m http.server %PORT%
if errorlevel 1 (
  echo.
  echo  python が見つかりませんでした。py コマンドで再試行します...
  py -m http.server %PORT%
)

endlocal
