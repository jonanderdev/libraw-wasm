// SCANND FORK: direct-mode type definitions.
//
// The default export (`./index`) wraps everything in postMessage promises.
// This direct mode loads the WASM module in the caller's context and
// exposes the bound C++ methods synchronously. See direct.js for the
// rationale and caller contract.

import type { LibRawOptions, Metadata, RawImageData, ThumbnailImageData } from "./index";

/**
 * Direct-mode LibRaw instance.
 *
 * All methods are SYNCHRONOUS — they call into the WASM module directly,
 * with no postMessage roundtrip. The `imageData().data` field is a LIVE
 * VIEW over the WASM heap (see caller contract in direct.js).
 */
export interface DirectLibRaw {
	/**
	 * Parse the RAW data with optional settings.
	 *
	 * `data` is a Uint8Array of the raw file bytes. The bytes are copied
	 * into the WASM heap; the caller is free to release the input array
	 * afterwards.
	 */
	open(data: Uint8Array, options?: LibRawOptions): void;

	/**
	 * Retrieve metadata. Synchronous in direct mode.
	 */
	metadata(fullOutput?: boolean): Metadata | Record<string, unknown>;

	/**
	 * Retrieve processed image data. The `data` field is a LIVE VIEW over
	 * the WASM heap — see caller contract in direct.js. The processed
	 * image stays held on the libraw side until the next imageData() or
	 * clearProcessedImage() call.
	 */
	imageData(): RawImageData;

	/**
	 * Explicitly free the processed image buffer held alive for the most
	 * recent imageData() heap view. Safe to call multiple times.
	 * Invalidates any view returned by the most recent imageData().
	 */
	clearProcessedImage(): void;

	/**
	 * Retrieve the embedded JPEG preview (fast).
	 */
	thumbnailData(): ThumbnailImageData | undefined;
}

/**
 * Load the WASM module (once per realm) and instantiate a direct-mode
 * LibRaw. Subsequent calls share the underlying module instance.
 *
 * The Emscripten module uses pthreads. The host page must be cross-origin-
 * isolated (COOP/COEP headers) for full performance.
 */
export function createDirectLibRaw(): Promise<DirectLibRaw>;
