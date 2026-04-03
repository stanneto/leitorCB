import { createWorker, PSM } from 'tesseract.js';

const OCR_EXPECTED_LENGTH = 8;
const OCR_RETRY_INTERVAL_MS = 2400;

function ensureOcrCanvas(runtime, key, width, height) {
  const canvasKey = `${key}Canvas`;
  const contextKey = `${key}Context`;

  if (!runtime[canvasKey]) {
    runtime[canvasKey] = document.createElement('canvas');
    runtime[contextKey] =
      runtime[canvasKey].getContext('2d', { willReadFrequently: true }) ||
      runtime[canvasKey].getContext('2d');
  }

  if (runtime[canvasKey].width !== width) {
    runtime[canvasKey].width = width;
  }

  if (runtime[canvasKey].height !== height) {
    runtime[canvasKey].height = height;
  }

  return {
    canvas: runtime[canvasKey],
    context: runtime[contextKey]
  };
}

function getOcrRegions(video) {
  const frameWidth = video.videoWidth || 0;
  const frameHeight = video.videoHeight || 0;

  if (!frameWidth || !frameHeight) {
    return [];
  }

  return [
    {
      id: 'labelBottomTight',
      sx: Math.round(frameWidth * 0.18),
      sy: Math.round(frameHeight * 0.53),
      sw: Math.round(frameWidth * 0.64),
      sh: Math.round(frameHeight * 0.1)
    },
    {
      id: 'labelBottomWide',
      sx: Math.round(frameWidth * 0.1),
      sy: Math.round(frameHeight * 0.5),
      sw: Math.round(frameWidth * 0.8),
      sh: Math.round(frameHeight * 0.13)
    },
    {
      id: 'labelWithBars',
      sx: Math.round(frameWidth * 0.08),
      sy: Math.round(frameHeight * 0.41),
      sw: Math.round(frameWidth * 0.84),
      sh: Math.round(frameHeight * 0.24)
    }
  ];
}

function drawRegionVariant(runtime, video, region, variant) {
  const targetWidth = 1800;
  const targetHeight = variant === 'bars' ? 520 : 260;
  const { canvas, context } = ensureOcrCanvas(runtime, `${region.id}_${variant}`, targetWidth, targetHeight);

  context.save();
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.filter = 'grayscale(1) contrast(1.95) brightness(1.2)';
  context.imageSmoothingEnabled = true;
  context.drawImage(
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
  context.restore();

  if (variant === 'binary') {
    const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
    const { data } = imageData;

    for (let index = 0; index < data.length; index += 4) {
      const luminance = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      const value = luminance > 165 ? 255 : 0;

      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
  }

  return canvas;
}

function normalizeOcrText(text) {
  return String(text || '').replace(/\D+/g, '').trim();
}

function getCandidateScore(text, confidence) {
  let score = typeof confidence === 'number' ? confidence : 0;

  if (text.length === OCR_EXPECTED_LENGTH) {
    score += 25;
  }

  if (text.startsWith('0')) {
    score += 4;
  }

  return score;
}

export function isValidOcrCode(text) {
  return /^\d{8}$/.test(text);
}

async function getOcrWorker(runtime) {
  if (runtime.ocrWorker) {
    return runtime.ocrWorker;
  }

  const worker = await createWorker('eng', 1, {
    logger: () => {}
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

async function recognizeCanvas(worker, canvas) {
  const {
    data: { confidence, text }
  } = await worker.recognize(canvas);
  const normalized = normalizeOcrText(text);

  if (!isValidOcrCode(normalized)) {
    return null;
  }

  const resolvedConfidence = typeof confidence === 'number' ? confidence : 0;

  if (resolvedConfidence < 35) {
    return null;
  }

  return {
    confidence: resolvedConfidence,
    text: normalized
  };
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
    const regions = getOcrRegions(video);
    let bestCandidate = null;

    for (const region of regions) {
      for (const variant of ['clean', 'binary']) {
        const canvas = drawRegionVariant(runtime, video, region, variant);
        const candidate = await recognizeCanvas(worker, canvas);

        if (!candidate) {
          continue;
        }

        const score = getCandidateScore(candidate.text, candidate.confidence);

        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = {
            confidence: candidate.confidence,
            regionId: region.id,
            score,
            text: candidate.text,
            variant
          };
        }
      }
    }

    if (!bestCandidate) {
      return null;
    }

    return {
      confidence: bestCandidate.confidence,
      text: bestCandidate.text
    };
  } finally {
    runtime.ocrInFlight = false;
  }
}
