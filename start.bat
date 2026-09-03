@echo off
cd /d "%~dp0"
echo.
echo  Fast 3 verifier is running:
echo  Computer: http://localhost:8080
echo  Phone: use http://YOUR-COMPUTER-IP:8080 on the same Wi-Fi
echo.
py -m http.server 8080 --bind 0.0.0.0
