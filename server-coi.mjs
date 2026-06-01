// SCANND FORK: tiny static server with cross-origin-isolation headers,
// needed for the SharedArrayBuffer that USE_PTHREADS=1 requires.
//
// Run: node server-coi.mjs   (then visit http://localhost:9000/example-direct.html)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9000;

const MIME = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.mjs': 'application/javascript',
	'.wasm': 'application/wasm',
	'.json': 'application/json',
	'.css': 'text/css',
	'.map': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
};

http.createServer(async (req, res) => {
	// COOP/COEP for cross-origin isolation → enables SharedArrayBuffer → pthreads work.
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

	let urlPath = req.url.split('?')[0];
	if (urlPath === '/') urlPath = '/example-direct.html';
	const filePath = path.join(__dirname, decodeURIComponent(urlPath));
	if (!filePath.startsWith(__dirname)) {
		res.statusCode = 403; res.end('forbidden'); return;
	}
	try {
		const body = await fs.readFile(filePath);
		const ext = path.extname(filePath).toLowerCase();
		res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
		res.end(body);
	} catch {
		res.statusCode = 404;
		res.end('not found');
	}
}).listen(PORT, () => {
	console.log(`COI static server on http://localhost:${PORT}/`);
});
