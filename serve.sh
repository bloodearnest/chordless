#!/bin/bash
# Simple static file server for development with auto-reload
# Usage: ./serve.sh [port]

PORT=${1:-8000}

echo "Starting Setalight static server at http://localhost:$PORT with auto-reload"
echo "Watching: serve.py, *.js, *.css, *.html"
echo "Press Ctrl+C to stop"
echo ""

# Use entr to watch files and restart server on changes
ls serve.py *.js *.css *.html 2>/dev/null | entr -r python3 serve.py $PORT
