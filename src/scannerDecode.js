import {
  BinaryBitmap,
  GlobalHistogramBinarizer,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer
} from '@zxing/library';

export function ensureCaptureCanvas(runtime, width, height) {
  if (!runtime.captureCanvas) {
    runtime.captureCanvas = document.createElement('canvas');
    runtime.captureContext = runtime.captureCanvas.getContext('2d', { willReadFrequently: true }) || runtime.captureCanvas.getContext('2d');
  }

  if (runtime.captureCanvas.width !== width) {
    runtime.captureCanvas.width = width;
  }

  if (runtime.captureCanvas.height !== height) {
    runtime.captureCanvas.height = height;
  }

  return runtime.captureCanvas;
}

export function getDecodeRegions(video) {
  const frameWidth = video.videoWidth || 0;
  const frameHeight = video.videoHeight || 0;

  if (!frameWidth || !frameHeight) {
    return [];
  }

  const linearTight = {
    sx: Math.round(frameWidth * 0.14),
    sy: Math.round(frameHeight * 0.41),
    sw: Math.round(frameWidth * 0.72),
    sh: Math.round(frameHeight * 0.12)
  };

  const linearWide = {
    sx: Math.round(frameWidth * 0.08),
    sy: Math.round(frameHeight * 0.37),
    sw: Math.round(frameWidth * 0.84),
    sh: Math.round(frameHeight * 0.18)
  };

  const linearMedium = {
    sx: Math.round(frameWidth * 0.1),
    sy: Math.round(frameHeight * 0.31),
    sw: Math.round(frameWidth * 0.8),
    sh: Math.round(frameHeight * 0.24)
  };

  const linearFull = {
    sx: Math.round(frameWidth * 0.04),
    sy: Math.round(frameHeight * 0.24),
    sw: Math.round(frameWidth * 0.92),
    sh: Math.round(frameHeight * 0.38)
  };

  const squareSize = Math.round(Math.min(frameWidth, frameHeight) * 0.68);
  const centerSquare = {
    sx: Math.round((frameWidth - squareSize) / 2),
    sy: Math.round((frameHeight - squareSize) / 2),
    sw: squareSize,
    sh: squareSize
  };

  const fullFrame = {
    sx: 0,
    sy: 0,
    sw: frameWidth,
    sh: frameHeight
  };

  return [linearTight, linearWide, linearMedium, linearFull, centerSquare, fullFrame];
}

export function drawDecodeRegion(runtime, video, region) {
  const isLinearRegion = region.sw > region.sh;
  const targetWidth = isLinearRegion ? Math.max(960, region.sw) : Math.max(720, region.sw);
  const targetHeight = isLinearRegion ? Math.max(260, region.sh) : Math.max(720, region.sh);
  const canvas = ensureCaptureCanvas(runtime, targetWidth, targetHeight);

  runtime.captureContext.drawImage(
    video,
    region.sx,
    region.sy,
    region.sw,
    region.sh,
    0,
    0,
    targetWidth,
    targetHeight
  );

  return canvas;
}

export function decodeCanvasWithReader(reader, canvas) {
  const luminanceSource = new HTMLCanvasElementLuminanceSource(canvas, true);
  const hybridBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));

  try {
    return reader.decodeWithState(hybridBitmap);
  } catch (hybridError) {
    if (
      hybridError &&
      (hybridError.name === 'NotFoundException' ||
        hybridError.name === 'ChecksumException' ||
        hybridError.name === 'FormatException')
    ) {
      const histogramBitmap = new BinaryBitmap(new GlobalHistogramBinarizer(luminanceSource));
      return reader.decodeWithState(histogramBitmap);
    }

    throw hybridError;
  }
}

export function decodeCurrentFrame(reader, runtime, video) {
  const regions = getDecodeRegions(video);
  let lastError = null;

  for (const region of regions) {
    try {
      const canvas = drawDecodeRegion(runtime, video, region);
      const result = decodeCanvasWithReader(reader, canvas);

      if (result) {
        return { result };
      }
    } catch (error) {
      lastError = error;
    }
  }

  return { error: lastError };
}

export function isTransientDecodeError(error, activatedAt) {
  const errorName = String(error?.name || '');
  const errorMessage = String(error?.message || '').toLowerCase();
  const isClassicRetryable =
    errorName === 'NotFoundException' ||
    errorName === 'ChecksumException' ||
    errorName === 'FormatException';

  if (isClassicRetryable) {
    return true;
  }

  const isRetryableMessage =
    errorMessage.includes('no multiformat readers were able to detect the code') ||
    errorMessage.includes('no readers were able to detect the code') ||
    errorMessage.includes('no barcode found') ||
    errorMessage.includes('not found');

  if (isRetryableMessage) {
    return true;
  }

  const warmupWindowActive = activatedAt > 0 && Date.now() - activatedAt < 5000;
  const looksLikeVideoWarmupIssue =
    errorName === 'InvalidStateError' ||
    errorName === 'IndexSizeError' ||
    errorName === 'AbortError' ||
    errorMessage.includes('video') ||
    errorMessage.includes('canvas') ||
    errorMessage.includes('source') ||
    errorMessage.includes('not ready') ||
    errorMessage.includes('not enough data') ||
    errorMessage.includes('non-zero') ||
    errorMessage.includes('width') ||
    errorMessage.includes('height') ||
    errorMessage.includes('play()');

  return warmupWindowActive && looksLikeVideoWarmupIssue;
}
