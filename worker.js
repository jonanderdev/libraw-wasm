import LibRawModule from './libraw.js';

let ready;
let LibRawClass;
let raw;

// SCANND FORK: lower the WASM heap's INITIAL_MEMORY at runtime.
//
// The module is compiled with INITIAL_MEMORY=256MB (compileLibraw.sh), which the
// Emscripten glue reads from `Module["INITIAL_MEMORY"]` BEFORE building the
// shared WebAssembly.Memory — so passing it into the factory overrides the
// baseline with NO recompile. 256MB is reserved up front and (WASM linear memory
// can't shrink) never released. On iOS that fixed 256MB is half a ~512MB tab
// budget BEFORE a single pixel is decoded — it stacked under the full-res
// imageData() buffer + the .slice() copy and Jetsam-killed a 24MP RAW export
// (confirmed on-device: crash at imageData-done). ALLOW_MEMORY_GROWTH=1 is on,
// so the heap still grows on demand to whatever the decode needs (~144MB for a
// 24MP 16-bit frame); we just stop reserving it up front. 48MB comfortably holds
// the module + small allocs before the first decode grows it.
const LIBRAW_INITIAL_MEMORY = 48 * 1024 * 1024;

async function initLibRaw() {
	ready = (async () => {
		const module = await LibRawModule({ INITIAL_MEMORY: LIBRAW_INITIAL_MEMORY });
		LibRawClass = module.LibRaw;
		raw = new LibRawClass();
	})();
}

initLibRaw();

function isTypedArray(obj) {
	return ArrayBuffer.isView(obj) && !(obj instanceof DataView);
}

// SCANND FORK: detach typed-array results from the WASM heap before posting.
//
// The C++ side (toJSTypedArray) now returns a LIVE VIEW over the WASM heap
// (typed_memory_view, no copy). That's the point of the fork — direct-mode
// callers (./direct.js) can use the view in place. But this file is the
// default-class path, which wraps everything in postMessage. A heap view's
// .buffer IS the WASM heap (often SAB-backed when the host page is COI'd),
// which the browser refuses to transfer; without intervention, postMessage
// falls back to structured clone on shared memory, which fails outright in
// modern browsers.
//
// Detaching via .slice() copies the visible bytes into a fresh JS-owned
// ArrayBuffer which we then TRANSFER (zero-cost ownership handoff). One
// explicit memcpy on this thread, zero structured-clone work.
//
// After the copy, the libraw-side processed image can be freed via
// clearProcessedImage (the fork's binding) — keeps the WASM heap from
// growing indefinitely across repeated imageData calls.
self.onmessage = async (event) => {
	const {fn, args} = event.data;
	try {
		await ready;
		const out = raw[fn](...args);
		const transferList = [];
		if (out && typeof out === 'object') {
			for (const key in out) {
				const value = out[key];
				if (isTypedArray(value)) {
					const owned = value.slice();
					out[key] = owned;
					transferList.push(owned.buffer);
				}
			}
			if (fn === 'imageData' && typeof raw.clearProcessedImage === 'function') {
				try { raw.clearProcessedImage(); } catch { /* */ }
			}
		}
		self.postMessage({out}, transferList);
	} catch (err) {
		self.postMessage({error: err.message});
	}
};