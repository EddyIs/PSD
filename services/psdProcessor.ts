
/**
 * Advanced Memory Safe PSD Processor
 * Optimized for low-RAM environments like web browsers
 */

/**
 * Robustly converts raw pixel buffers to HTMLCanvasElement.
 * Uses proactive memory checks and error handling to prevent OOM.
 */
export const imageDataToCanvas = (layer: any): HTMLCanvasElement | null => {
  if (layer.canvas) return layer.canvas;
  if (!layer.canvasData || !layer.width || !layer.height) return null;

  // STRICT LIMIT: Browsers often fail to allocate single blocks larger than 400-500MB.
  // A 8000x8000 RGBA image is ~256MB. We set a conservative limit here.
  const PIXEL_LIMIT = 48_000_000; 
  if (layer.width * layer.height > PIXEL_LIMIT) {
    console.error(`[MemoryGuard] Refused to allocate ${layer.width}x${layer.height} layer (Too large for browser heap).`);
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = layer.width;
    canvas.height = layer.height;
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    
    if (!ctx) return null;

    // Check if we can safely create ImageData
    // This is where most "Out of memory" errors happen.
    const imgData = new ImageData(layer.canvasData, layer.width, layer.height);
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  } catch (e) {
    if (e instanceof RangeError || (e instanceof Error && e.message.includes('Out of memory'))) {
      console.warn(`[MemoryGuard] Critical: Browser memory exhausted while processing "${layer.name}".`);
    } else {
      console.error("[MemoryGuard] Unknown error during canvas synthesis:", e);
    }
    return null;
  }
};

/**
 * Trims transparent pixels from the edges of an image.
 * Uses a scanline algorithm with early exit for performance.
 */
export const trimCanvas = (input: HTMLCanvasElement | any): { canvas: HTMLCanvasElement, width: number, height: number } | null => {
  let canvas: HTMLCanvasElement | null = null;
  
  if (input instanceof HTMLCanvasElement) {
    canvas = input;
  } else {
    canvas = imageDataToCanvas(input);
  }

  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

  // Don't attempt to trim massive layers to save CPU/Memory
  const TRIM_LIMIT = 16_000_000; 
  if (canvas.width * canvas.height > TRIM_LIMIT) {
    return { canvas, width: canvas.width, height: canvas.height };
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  try {
    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let hasAlpha = false;

    // Fast scanning
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 0) {
          hasAlpha = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!hasAlpha) return null;

    const croppedWidth = maxX - minX + 1;
    const croppedHeight = maxY - minY + 1;

    // If no trimming is needed, return original
    if (croppedWidth === width && croppedHeight === height) {
      return { canvas, width, height };
    }

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = croppedWidth;
    croppedCanvas.height = croppedHeight;
    const croppedCtx = croppedCanvas.getContext('2d');
    
    if (croppedCtx) {
      croppedCtx.drawImage(canvas, minX, minY, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
    }

    return { canvas: croppedCanvas, width: croppedWidth, height: croppedHeight };
  } catch (e) {
    console.warn("[MemoryGuard] Trimming failed, returning raw canvas.", e);
    return { canvas, width: canvas.width, height: canvas.height };
  }
};
