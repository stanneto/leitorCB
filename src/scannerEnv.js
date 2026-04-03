export function isIosDevice() {
  const userAgent = window.navigator.userAgent || '';
  const platform = window.navigator.platform || '';
  const maxTouchPoints = window.navigator.maxTouchPoints || 0;

  return /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function stopTracks(stream) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function scoreCameraLabel(label) {
  const normalized = String(label || '').toLowerCase();
  let score = 0;

  if (normalized.includes('back') || normalized.includes('rear') || normalized.includes('traseira') || normalized.includes('environment')) {
    score += 8;
  }

  if (normalized.includes('wide')) {
    score += 2;
  }

  if (normalized.includes('front') || normalized.includes('frontal') || normalized.includes('user') || normalized.includes('face')) {
    score -= 10;
  }

  return score;
}

function pickBestCamera(devices) {
  if (!Array.isArray(devices) || devices.length === 0) {
    return null;
  }

  return devices
    .slice()
    .sort((left, right) => scoreCameraLabel(right.label) - scoreCameraLabel(left.label))[0];
}

function getPrimaryVideoConstraints() {
  return {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      frameRate: { ideal: 24, max: 30 },
      width: { ideal: isIosDevice() ? 1920 : 1280 },
      height: { ideal: isIosDevice() ? 1080 : 720 },
      aspectRatio: { ideal: 1.7777777778 }
    }
  };
}

function getFallbackVideoConstraints() {
  return {
    audio: false,
    video: {
      frameRate: { ideal: 24, max: 30 },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };
}

async function listVideoDevicesSafe() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return [];
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput');
  } catch (error) {
    console.warn('Não foi possível listar as câmeras.', error);
    return [];
  }
}

async function applyTrackTuning(track) {
  if (!track || !track.getCapabilities || !track.applyConstraints) {
    return;
  }

  try {
    const capabilities = track.getCapabilities();
    const advanced = [];

    if (Array.isArray(capabilities.focusMode)) {
      if (capabilities.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      } else if (capabilities.focusMode.includes('single-shot')) {
        advanced.push({ focusMode: 'single-shot' });
      }
    }

    if (capabilities.zoom && typeof capabilities.zoom.max === 'number') {
      const minZoom = typeof capabilities.zoom.min === 'number' ? capabilities.zoom.min : 1;
      const maxZoom = capabilities.zoom.max;

      if (maxZoom > minZoom) {
        const preferredZoom = isIosDevice() ? 1.15 : 1.1;
        advanced.push({ zoom: Math.min(maxZoom, Math.max(minZoom, preferredZoom)) });
      }
    }

    if (advanced.length > 0) {
      await track.applyConstraints({ advanced });
    }
  } catch (error) {
    console.warn('Ajustes extras de foco e zoom não puderam ser aplicados.', error);
  }
}

export async function requestBestAvailableStream() {
  let stream;

  try {
    stream = await navigator.mediaDevices.getUserMedia(getPrimaryVideoConstraints());
  } catch (primaryError) {
    const primaryMessage = String(primaryError?.message || primaryError);

    if (
      primaryMessage.includes('OverconstrainedError') ||
      primaryMessage.includes('NotFoundError') ||
      primaryMessage.includes('ConstraintNotSatisfiedError')
    ) {
      stream = await navigator.mediaDevices.getUserMedia(getFallbackVideoConstraints());
    } else {
      throw primaryError;
    }
  }

  const devices = await listVideoDevicesSafe();
  const preferredDevice = pickBestCamera(devices);
  const videoTrack = stream.getVideoTracks()[0];
  const settings = videoTrack?.getSettings ? videoTrack.getSettings() : {};
  const currentLabel = videoTrack?.label || '';
  const usingFrontCamera = String(settings.facingMode || '').toLowerCase() === 'user' || scoreCameraLabel(currentLabel) < 0;

  if (preferredDevice && usingFrontCamera) {
    try {
      const retryStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: preferredDevice.deviceId },
          frameRate: { ideal: 24, max: 30 },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      stopTracks(stream);
      stream = retryStream;
    } catch (retryError) {
      console.warn('Não foi possível trocar para a câmera traseira preferida.', retryError);
    }
  }

  await applyTrackTuning(stream.getVideoTracks()[0]);

  return stream;
}

export function describeCameraError(error) {
  const message = String(error?.message || error);
  const name = String(error?.name || '');

  if (name === 'NotAllowedError' || message.includes('Permission denied')) {
    return { type: 'denied' };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { type: 'noCamera' };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError' || message.includes('Could not start video source')) {
    return { type: 'unavailable' };
  }

  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return {
      type: 'unavailable',
      text: 'A configuração da câmera não foi aceita pelo aparelho. Tentamos um fallback, mas a câmera não iniciou.'
    };
  }

  return { type: 'initError', text: `Detalhe: ${message}` };
}
