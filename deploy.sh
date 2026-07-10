#!/bin/bash
# Script tự động deploy instance 43G: tắt app -> git pull -> bật lại
# Dùng: bash deploy.sh
# Chạy từ thư mục gốc project trên server: /home/tvr/43G-flycam-gis-viewer

set -e
cd /home/tvr/43G-flycam-gis-viewer

echo "[1/3] Dung app hien tai (chi port 3003)..."
# Pattern phai kem --port: instance kia cung chay "node server.js", pkill se giet nham.
pkill -f "server.js --port 3003" 2>/dev/null && echo "  -> Da dung." || echo "  -> App chua chay, bo qua."
sleep 1

echo "[2/3] Git pull code moi nhat..."
git pull

echo "[3/3] Khoi dong lai app..."
nohup npm run start -- --port 3003 --public >> app.log 2>&1 &
echo "  -> Dang chay (PID $!), log ghi vao app.log"
echo ""
echo "Xong! Mo trinh duyet: http://14.224.210.210:3003/Apps/HelloWorld.html"
