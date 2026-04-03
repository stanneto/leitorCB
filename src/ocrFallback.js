import { createWorker, PSM } from 'tesseract.js';

const OCR_MIN_LENGTH = 6;
const OCR_MAX_LENGTH = 20;
const OCR_RETRY_INTERVAL_MS = 2800;

function ensureOcrCanvas(runtime, width, height) {
  if (!runtime.ocrCanvas) {
    runtime.ocrCanvas = document.createElement('canvas');
    runtime.ocrContext = runtime.ocrCanvas.getContext('2d', { willReadFrequently: true }) || runtime.ocrCanvas.getContext('2d');
  }

  if (runtime.ocrCanvas.width !== width) {
    runtime.ocrCanvas.width = width;
  }

  if (runtime.ocrCanvas.height !== height) {
    runtime.ocrCanvas.height = height;
  }

  return runtime.ocrCanvas;
}

function drawOcrRegion(runtime, video) {
  const frameWidth = video.videoWidth || 0;
  const frameHeight = video.videoHeight || 0;

  if (!frameWidth || !frameHeight) {
    return null;
  }

  const source = {
    sx: Math.round(frameWidth * 0.08),
    sy: Math.round(frameHeight * 0.34),
    sw: Math.round(frameWidth * 0.84),
    sh: Math.round(frameHeight * 0.24)
  };
  const targetWidth = 1800;
  const targetHeight = 520;
  const canvas = ensureOcrCanvas(runtime, targetWidth, targetHeight);
  const context = runtime.ocrContext;

  context.save();
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.filter = 'grayscale(1) contrast(1.65) brightness(1.18)';
  context.imageSmoothingEnabled = true;
  context.drawImage(
    video,
    source.sx,
    source.sy,
    source.sw,
    source.sh,
    0,
    0,
    targetWidth,
    targetHeight
  );
  context.restore();

  return canvas;
}

function normalizeOcrText(text) {
  return String(text || '').replace(/\D+/g, '').trim();
}

export function isValidOcrCode(text) {
  return /^\d+$/.test(text) && text.length >= OCR_MIN_LENGTH && text.length <= OCR_MAX_LENGTH;
}

async function getOcrWorker(runtime) {
  if (runtime.ocrWorker) {
    return runtime.ocrWorker;
  }

  const worker = await createWorker('eng', 1, {
    logger: (message) => {
      if (message?.status === 'recognizing text' || message?.status === 'loading language traineddata') {
        runtime.lastOcrProgress = message;
      }
    }
  });

  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    preserve_interword_spaces: '0',
    user_defined_dpi: '300'
  });

  runtime.ocrWorker = worker;
  return worker;
}

export async function terminateOcrWorker(runtime) {
  if (!runtime?.ocrWorker) {
    return;
  }

  try {
    await runtime.ocrWorker.terminate();
  } catch (error) {
    console.warn('Falha ao encerrar o worker de OCR.', error);
  } finally {
    runtime.ocrWorker = null;
    runtime.ocrInFlight = false;
  }
}

export async function tryRecognizeNumericOcr(runtime, video) {
  const now = Date.now();

  if (
    runtime.ocrInFlight ||
    !video ||
    video.readyState < 2 ||
    now - (runtime.lastOcrAttemptAt || 0) < OCR_RETRY_INTERVAL_MS
  ) {
    return null;
  }

  runtime.ocrInFlight = true;
  runtime.lastOcrAttemptAt = now;

  try {
    const worker = await getOcrWorker(runtime);
    const canvas = drawOcrRegion(runtime, video);

    if (!canvas) {
      return null;
    }

    const {
      data: { text, confidence }
    } = await worker.recognize(canvas);
    const normalized = normalizeOcrText(text);

    if (!isValidOcrCode(normalized)) {
      return null;
    }

    if (typeof confidence === 'number' && confidence < 45) {
      return null;
    }

    return {
      confidence: typeof confidence === 'number' ? confidence : null,
      text: normalized
    };
  } finally {
    runtime.ocrInFlight = false;
  }
}
