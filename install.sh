#!/bin/bash
set -e

echo "Media Archiver - Installation"
echo "============================="

# Check dependencies
command -v python3 >/dev/null || { echo "Error: python3 required"; exit 1; }
command -v ffmpeg >/dev/null || echo "Warning: ffmpeg not found (needed for video processing)"

# Create virtual environment
echo "Creating Python virtual environment..."
cd "$(dirname "$0")/server"
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

echo ""
echo "Installation complete!"
echo ""
echo "To start the server:"
echo "  cd server && source venv/bin/activate && python3 -m uvicorn main:app --port 8888"
echo ""
echo "To install the browser extension:"
echo "  Firefox: about:debugging → Load Temporary Add-on → select extension/manifest.json"
echo "  Chrome:  chrome://extensions → Load unpacked → select extension/"
echo ""
echo "Dashboard: http://localhost:8888/dashboard"
