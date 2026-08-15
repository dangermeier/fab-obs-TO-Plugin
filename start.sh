#!/bin/bash
echo ""
echo " FAB OBS TO Plugin"
echo " =================="
echo ""

if ! command -v node &> /dev/null; then
    echo " ERROR: Node.js is not installed."
    echo " Please download it from https://nodejs.org and run this again."
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo " Checking dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo ""
    echo " ERROR: npm install failed. See error above."
    read -p "Press Enter to exit..."
    exit 1
fi

echo ""
echo " Opening config page in browser..."
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:3000/config/" &
elif command -v open &> /dev/null; then
    open "http://localhost:3000/config/" &
fi

echo " Starting server..."
echo " (Keep this window open while streaming)"
echo ""
node server.js

echo ""
echo " Server stopped."
read -p "Press Enter to exit..."
