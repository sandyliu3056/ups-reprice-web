@echo off
REM ===================================================================
REM UPS Reprice Tool -- 打包
REM 放在 UPS_Reprice_Tool.py 旁邊,雙擊執行。
REM ===================================================================
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo === 1/4  檢查 Python ===
python --version
if errorlevel 1 (
    echo [X] 找不到 python。裝 Python 時要勾 "Add to PATH"。
    pause & exit /b 1
)

echo.
echo === 2/4  安裝相依套件 ===
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [X] 套件裝不起來,先看上面的錯誤。
    pause & exit /b 1
)

echo.
echo === 3/4  清掉上一次的產出 ===
REM 不清乾淨的話,PyInstaller 會沿用舊的 build 快取,
REM 出現「我改了但沒變」的老問題。
if exist build rmdir /s /q build
if exist dist  rmdir /s /q dist

echo.
echo === 4/4  打包 ===
python -m PyInstaller UPS_Reprice_Tool.spec --noconfirm --clean
if errorlevel 1 (
    echo [X] 打包失敗。
    pause & exit /b 1
)

echo.
echo === 把設定和歷史複製到 exe 旁邊 ===
REM 這兩個檔案決定「算出來的錢一不一樣」,不是選配。
if exist ups_billing_tool_config.json (
    copy /y ups_billing_tool_config.json "dist\UPS_Reprice_Tool\" >nul
    echo   [v] ups_billing_tool_config.json
) else (
    echo   [!] 沒有 config,exe 第一次開會是全新空白設定,費率要重建。
)
if exist ups_history.sqlite3 (
    copy /y ups_history.sqlite3 "dist\UPS_Reprice_Tool\" >nul
    echo   [v] ups_history.sqlite3
) else (
    echo   [!] 沒有歷史檔,跨期 ADJ/SCC 查不到原始 shipment。
)
if exist RepriceSketch.ttf copy /y RepriceSketch.ttf "dist\UPS_Reprice_Tool\" >nul
if exist verify_deploy.py  copy /y verify_deploy.py  "dist\UPS_Reprice_Tool\" >nul
if exist 部署說明.md        copy /y 部署說明.md        "dist\UPS_Reprice_Tool\" >nul

echo.
echo ===================================================================
echo  好了: dist\UPS_Reprice_Tool\
echo  整個資料夾壓縮起來給同事,不要只給 exe。
echo  給之前先在這台跑 verify_deploy.py,把結果留著對照。
echo ===================================================================
pause
