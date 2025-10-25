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
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        # API endpoint to import a song
        if path == '/api/import-song':
            self.handle_import_song()
        else:
            self.send_error(404, 'Not Found')

    def handle_import_song(self):
        """Handle song import from bookmarklet"""
        try:
            # Read the POST body
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)

            chordpro_text = data.get('chordproText')
            metadata = data.get('metadata', {})
            source = data.get('source', 'unknown')

            print(f'[API] Importing song: {metadata.get("title", "Untitled")}')
            print(f'[API] Source: {source}')
            print(f'[API] ChordPro length: {len(chordpro_text) if chordpro_text else 0}')

            # For now, just acknowledge receipt
            # You can add file saving logic here later
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {
                'success': True,
                'message': 'Song imported successfully',
                'metadata': metadata
            }
            self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f'[API] Import error: {e}')
            self.send_error(500, str(e))

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
        # API endpoint to import all setlists with full song content
        elif path == '/api/import':
            query = parse_qs(parsed_path.query)
            cutoff_date = query.get('cutoff', ['2025-01-01'])[0]
            self.handle_import(cutoff_date)
        # Setlist routes - serve setlist.html directly
        elif path.startswith('/setlist/') and not path.endswith('.html'):
            # Serve setlist.html for all /setlist/* routes
            self.path = '/setlist.html'
            super().do_GET()
        # Songs library route - serve songs.html for /songs and /songs/{id}
        elif path == '/songs' or path == '/songs/' or (path.startswith('/songs/') and not path.endswith('.html')):
            self.path = '/songs.html'
            super().do_GET()
        # Settings page route - serve settings.html
        elif path == '/settings' or path == '/settings/':
            self.path = '/settings.html'
            super().do_GET()
        # Bookmarklet installation page
        elif path == '/bookmarklet' or path == '/bookmarklet/':
            self.path = '/bookmarklet-install.html'
            super().do_GET()
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

            # Find all .txt files
            song_files = glob.glob(f'{setlist_path}/*.txt')
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

    def handle_import(self, cutoff_date):
        """Return all setlists with full song content for import"""
        try:
            # Find all directories in sets/
            setlist_dirs = glob.glob('sets/*/')
            setlists = []

            for dir_path in setlist_dirs:
                # Extract date from directory name (format: sets/YYYY-MM-DD/)
                date_str = os.path.basename(dir_path.rstrip('/'))

                # Extract date from directory name (format: YYYY-MM-DD or YYYY-MM-DD-event-name)
                date_match = date_str.split('-')
                if len(date_match) >= 3:
                    date = f'{date_match[0]}-{date_match[1]}-{date_match[2]}'

                    # Filter by cutoff date
                    if date >= cutoff_date:
                        # Find all .txt song files
                        song_files = glob.glob(f'{dir_path}/*.txt')
                        song_files.sort()

                        songs = []
                        for song_file in song_files:
                            try:
                                with open(song_file, 'r', encoding='utf-8') as f:
                                    content = f.read()
                                    songs.append({
                                        'filename': os.path.basename(song_file),
                                        'content': content
                                    })
                            except Exception as e:
                                print(f'Error reading {song_file}: {e}')

                        if songs:  # Only include setlists with songs
                            setlists.append({
                                'id': date_str,
                                'date': date,
                                'name': date_str,
                                'songs': songs
                            })

            # Sort by date, oldest first for consistent ordering
            setlists.sort(key=lambda x: x['date'])

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(setlists).encode())
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
        // Register service worker and reload (only if not already controlling)
        if ('serviceWorker' in navigator) {
            // Check if SW is already controlling this page
            if (navigator.serviceWorker.controller) {
                // SW is already controlling but still served this shell - something is wrong
                // This shouldn't happen in normal operation
                console.error('Service worker is controlling but still got app shell');
            } else {
                // Register SW and reload
                navigator.serviceWorker.register('/service-worker.js').then(() => {
                    // Wait for SW to be ready before reloading
                    return navigator.serviceWorker.ready;
                }).then(() => {
                    // Reload to let service worker handle the request
                    window.location.reload();
                });
            }
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
    server_address = ('0.0.0.0', port)
    httpd = HTTPServer(server_address, SetalightAPIHandler)

    # Get local IP for easier tablet access
    import socket
    hostname = socket.gethostname()
    try:
        local_ip = socket.gethostbyname(hostname)
    except:
        local_ip = '127.0.0.1'

    print(f'Starting Setalight server on:')
    print(f'  Local:   http://localhost:{port}')
    print(f'  Network: http://{local_ip}:{port}')
    print(f'  All interfaces: http://0.0.0.0:{port}')
    print('Press Ctrl+C to stop')
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
