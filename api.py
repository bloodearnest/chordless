#!/usr/bin/env python3
"""
Simple API server for Setalight app
"""
import os
import json
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import glob

class SetalightAPIHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_path = urlparse(self.path)

        # Remove hash fragment (shouldn't be sent to server, but just in case)
        path = parsed_path.path

        # API endpoint to list setlists
        if path == '/api/setlists':
            self.handle_setlists()
        # API endpoint to list songs in a setlist
        elif path == '/api/songs':
            query = parse_qs(parsed_path.query)
            setlist = query.get('setlist', [None])[0]
            if setlist:
                self.handle_songs(setlist)
            else:
                self.send_error(400, 'Missing setlist parameter')
        # App routes - return a shell HTML that registers the service worker
        elif path.startswith('/setlist/'):
            self.serve_app_shell()
        elif path == '/':
            self.path = '/index.html'
            super().do_GET()
        else:
            # Serve static files
            super().do_GET()

    def handle_setlists(self):
        """Return list of available setlists"""
        try:
            # Find all directories in sets/
            setlist_dirs = glob.glob('sets/*/')
            setlists = []

            for dir_path in setlist_dirs:
                # Extract date from directory name (format: sets/YYYY-MM-DD/)
                date_str = os.path.basename(dir_path.rstrip('/'))
                setlists.append({
                    'id': date_str,
                    'date': date_str,
                    'path': dir_path
                })

            # Sort by date, most recent first
            setlists.sort(key=lambda x: x['date'], reverse=True)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(setlists).encode())
        except Exception as e:
            self.send_error(500, str(e))

    def handle_songs(self, setlist_id):
        """Return list of songs in a setlist"""
        try:
            setlist_path = f'sets/{setlist_id}'
            if not os.path.isdir(setlist_path):
                self.send_error(404, 'Setlist not found')
                return

            # Find all .txt files (excluding non-song files)
            song_files = glob.glob(f'{setlist_path}/*.txt')
            # Filter out non-song files
            song_files = [f for f in song_files if os.path.basename(f)[0].isdigit()]
            song_files.sort()

            songs = []
            for file_path in song_files:
                songs.append({
                    'filename': os.path.basename(file_path),
                    'path': file_path
                })

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(songs).encode())
        except Exception as e:
            self.send_error(500, str(e))

    def serve_app_shell(self):
        """Serve a minimal HTML shell that will be replaced by service worker"""
        html = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading...</title>
    <script>
        // Register service worker and reload
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').then(() => {
                // Reload to let service worker handle the request
                window.location.reload();
            });
        } else {
            document.body.innerHTML = '<p>Service Worker not supported. Please use a modern browser.</p>';
        }
    </script>
</head>
<body>
    <p>Loading...</p>
</body>
</html>'''
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(html.encode())

def run_server(port=8000):
    server_address = ('', port)
    httpd = HTTPServer(server_address, SetalightAPIHandler)
    print(f'Starting Setalight server on http://localhost:{port}')
    print('Press Ctrl+C to stop')
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
