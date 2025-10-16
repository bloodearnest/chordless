#!/bin/bash
# Simple HTTP server for development with API support and auto-reload
# Usage: ./serve.sh [port]

PORT=${1:-8000}

echo "Starting Setalight server at http://localhost:$PORT with auto-reload"
echo "Watching: api.py, *.js, *.css, *.html"
echo "Press Ctrl+C to stop"
echo ""

# Use entr to watch files and restart server on changes
ls api.py *.js *.css *.html 2>/dev/null | entr -r python3 api.py
