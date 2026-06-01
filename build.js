import { build } from 'esbuild';
import { promises as fs } from "fs";


(async () => {
	try {
		let librawjs = (await fs.readFile('./libraw.js')).toString();
		librawjs = librawjs.replace(/var workerOptions=([^]+?);worker=new Worker\(new URL\("([^"]+)",import.meta.url\),workerOptions\);/, `worker=new Worker(new URL("$2",import.meta.url),$1);`); // Correction to make worker options static so that it works with vite
		await fs.writeFile('./libraw.js', librawjs);
		await build({
			// SCANND FORK: added direct.js as a separate entry point. It's a
			// thin re-export of libraw.js that lets consumers host the WASM
			// module in their own worker (zero-copy heap-view access).
			entryPoints: ['index.js', 'worker.js', 'libraw.js', 'direct.js'],
			outdir: 'dist', // Output directory
			bundle: true, // Bundle all files
			minify: true, // Minify the output
			sourcemap: true, // Generate source maps
			format: 'esm', // Output format (ES Module)
		});
		await fs.copyFile('./libraw.wasm', './dist/libraw.wasm');
		await fs.copyFile('./index.d.ts', './dist/index.d.ts');
		// SCANND FORK: ship direct.d.ts alongside the bundled direct.js.
		await fs.copyFile('./direct.d.ts', './dist/direct.d.ts');
		console.log('Build successful!');
	} catch (error) {
		console.error('Build failed:', error);
		process.exit(1);
	}
})();