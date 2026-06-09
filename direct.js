// SCANND FORK: direct-mode entry point.
//
// The default export (`./index.js`) instantiates an inner Web Worker that
// hosts the WASM module. Every imageData() call from the consumer's worker
// then has to cross TWO postMessage boundaries (consumer → wrapper → inner
// worker, and back). The pixel buffer returned from imageData() is a view
// over the WASM heap, which cannot be transferred across postMessage — so
// the browser performs a structured-clone copy on the way out. For a 26MP
// RAW (~155MB at outputBps:16) that copy is 20-38s on typical hardware.
//
// This entry point skips the inner worker. The caller (already running in
// a worker) loads the Emscripten module directly and calls the LibRaw
// class via embind. The pixel buffer stays in the SAME context where the
// WASM heap lives, so the view can be read in place (e.g. in-place denoise
// and tone-curve passes) without crossing a postMessage boundary.
//
// CALLER CONTRACT (see also index.d.ts):
//   - All methods on the returned instance are SYNCHRONOUS (no async/await).
//     They invoke the WASM module's bound C++ methods directly.
//   - imageData() returns { data, ... } where `data` is a LIVE VIEW over the
//     WASM heap. Mutations through it write back into the heap. Allocations
//     into the heap (any libraw call) can invalidate the view's backing
//     buffer if the heap grows.
//   - The processed image is held alive on the libraw side until the next
//     imageData() call OR an explicit clearProcessedImage() call OR the
//     LibRaw instance is destroyed.
//   - Recommended flow:
//       const raw = await createDirectLibRaw();
//       raw.open(bytes, opts);
//       const img = raw.imageData();
//       // ... use img.data in place ...
//       raw.clearProcessedImage();   // free heap pressure when done
//   - The Emscripten module uses pthreads (USE_PTHREADS=1). The host page
//     must be cross-origin-isolated (COOP/COEP headers); otherwise pthreads
//     are silently downgraded and the decode runs single-threaded.

import LibRawModule from "./libraw.js";

let cachedModulePromise = null;

/**
 * Load the WASM module once per realm. Subsequent calls return the same
 * module promise. Caching is per-realm because the underlying Emscripten
 * `Module()` factory creates a fresh WASM instance per call — caching the
 * promise avoids paying the WASM compilation/instantiation cost more than
 * once when multiple createDirectLibRaw() calls happen in the same worker.
 */
// SCANND FORK: lower INITIAL_MEMORY from the compiled 256MB baseline (see
// worker.js for the full rationale). The Emscripten glue reads
// Module["INITIAL_MEMORY"] before building the heap, so this overrides it with
// no recompile; ALLOW_MEMORY_GROWTH=1 lets the heap grow on demand for the
// actual decode. Applied here too so the direct (desktop) path matches the
// default-class (iOS) path.
const LIBRAW_INITIAL_MEMORY = 48 * 1024 * 1024;

function loadModule() {
	if (!cachedModulePromise) {
		cachedModulePromise = LibRawModule({ INITIAL_MEMORY: LIBRAW_INITIAL_MEMORY });
	}
	return cachedModulePromise;
}

/**
 * Async factory. Returns a LibRaw instance whose methods are SYNCHRONOUS.
 * Awaits the underlying WASM module's initialization on first call.
 */
export async function createDirectLibRaw() {
	const module = await loadModule();
	return new module.LibRaw();
}
