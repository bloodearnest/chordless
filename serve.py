#!/usr/bin/env python3
"""
Simple static file server with CORS headers
Based on Python's built-in http.server with minimal modifications
"""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class CORSRequestHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with CORS headers"""

    def end_headers(self):
        # Add CORS headers to all responses
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        """Handle OPTIONS requests for CORS preflight"""
        self.send_response(200)
        self.end_headers()

    def copyfile(self, source, outputfile):
        """Override to handle connection resets gracefully (for media files)"""
        try:
            super().copyfile(source, outputfile)
        except (ConnectionResetError, BrokenPipeError):
            # Client closed connection - normal for media streaming
            pass

def run(port=8000):
    """Start the server"""
    server_address = ('', port)
    # Use ThreadingHTTPServer instead of HTTPServer for concurrent requests
    httpd = ThreadingHTTPServer(server_address, CORSRequestHandler)
    print(f"Serving HTTP on 0.0.0.0 port {port} (http://localhost:{port}/) ...")
    print("Using threaded server for concurrent requests")
    print("Press Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.shutdown()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run(port)
