@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================================
echo  XA MEASURE - Do tai nguyen co nam trong checksum khong
echo ================================================================
echo.
echo  Script nay can quyen Administrator.
echo  Neu chua co, no se bao va thoat.
echo.

if "%~1"=="" (
    python xa_measure.py
) else (
    python xa_measure.py %*
)

echo.
echo ================================================================
echo  XONG. Doc phan "KET QUA" o tren.
echo ================================================================
pause
