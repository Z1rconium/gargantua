#!/usr/bin/env python3
"""Static server + test sink. Serves the project root; additionally accepts
POST /__probe (JSON diagnostics -> probe.log) and POST /__shot (canvas dataURL
-> PNG on disk) so a headless browser can report acceptance results.

Usage: python3 tools/test_server.py [port] [outdir]
"""
import base64
import http.server
import json
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8613
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('.')
ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n)
        if self.path.startswith('/__probe'):
            (OUT / 'probe.log').open('a').write(body.decode('utf-8', 'replace') + '\n')
            print('[probe] received', len(body), 'bytes')
        elif self.path.startswith('/__shot'):
            data = body.decode('ascii', 'replace')
            tag = self.path.split('=')[-1] if '=' in self.path else 'live'
            if ',' in data:
                png = base64.b64decode(data.split(',', 1)[1])
                (OUT / f'shot_{tag}.png').write_bytes(png)
                print(f'[shot] wrote shot_{tag}.png', len(png), 'bytes')
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def log_message(self, fmt, *args):
        print('[req]', fmt % args)


if __name__ == '__main__':
    json  # noqa: imported for probe consumers
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as s:
        print(f'serving {ROOT} on :{PORT}, sink -> {OUT}')
        s.serve_forever()
