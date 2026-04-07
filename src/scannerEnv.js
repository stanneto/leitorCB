export function isIosDevice() {
  const userAgent = window.navigator.userAgent || '';
  const platform = window.navigator.platform || '';
  const maxTouchPoints = window.navigator.maxTouchPoints || 0;

  return /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function isMobileDevice() {
  const userAgent = window.navigator.userAgent || '';

  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || isIosDevice();
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

  if (
    normalized.includes('back') ||
    normalized.includes('rear') ||
    normalized.includes('traseira') ||
    normalized.includes('environment')
  ) {
    score += 8;
  }

  if (normalized.includes('wide') || normalized.includes('ultra')) {
    score += 2;
  }

  if (
    normalized.includes('front') ||
    normalized.includes('frontal') ||
    normalized.includes('user') ||
    normalized.includes('face')
  ) {
    score -= 10;
  }

  return score;
}

function isFrontCameraLabel(label) {
  return scoreCameraLabel(label) < 0;
}

function isRearCameraLabel(label) {
  return scoreCameraLabel(label) > 0;
}

function pickBestCamera(devices) {
  if (!Array.isArray(devices) || devices.length === 0) {
    return null;
  }

  const scoredDevices = devices
    .slice()
    .map((device) => ({ device, score: scoreCameraLabel(device.label) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scoredDevices[0]?.device || null;
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
      facingMode: { ideal: 'environment' },
      frameRate: { ideal: 24, max: 30 },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };
}

function getLastResortVideoConstraints() {
  return {
    audio: false,
    video: true
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
    console.warn('Nao foi possivel listar as cameras.', error);
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
    console.warn('Ajustes extras de foco e zoom nao puderam ser aplicados.', error);
  }
}

function getTrackSettings(track) {
  if (!track || !track.getSettings) {
    return {};
  }

  try {
    return track.getSettings() || {};
  } catch (error) {
    return {};
  }
}

function getTrackDeviceId(track) {
  return String(getTrackSettings(track).deviceId || '');
}

function getTrackFacingMode(track) {
  return String(getTrackSettings(track).facingMode || '').toLowerCase();
}

function isTrackLikelyFront(track) {
  const facingMode = getTrackFacingMode(track);
  const label = String(track?.label || '');

  return facingMode === 'user' || isFrontCameraLabel(label);
}

function isTrackLikelyRear(track) {
  const facingMode = getTrackFacingMode(track);
  const label = String(track?.label || '');

  return facingMode === 'environment' || isRearCameraLabel(label);
}

async function requestStreamWithConstraints(constraints) {
  return navigator.mediaDevices.getUserMedia(constraints);
}

async function requestSpecificDeviceStream(deviceId) {
  return requestStreamWithConstraints({
    audio: false,
    video: {
      deviceId: { exact: deviceId },
      frameRate: { ideal: 24, max: 30 },
      width: { ideal: isIosDevice() ? 1920 : 1280 },
      height: { ideal: isIosDevice() ? 1080 : 720 }
    }
  });
}

async function requestInitialStream() {
  const attempts = [
    getPrimaryVideoConstraints(),
    getFallbackVideoConstraints(),
    getLastResortVideoConstraints()
  ];
  let lastError = null;

  for (const constraints of attempts) {
    try {
      return await requestStreamWithConstraints(constraints);
    } catch (error) {
      lastError = error;
      const name = String(error?.name || '');
      const message = String(error?.message || '');
      const retryable =
        name === 'OverconstrainedError' ||
        name === 'ConstraintNotSatisfiedError' ||
        name === 'NotFoundError' ||
        message.includes('OverconstrainedError') ||
        message.includes('ConstraintNotSatisfiedError') ||
        message.includes('NotFoundError');

      if (!retryable) {
        throw error;
      }
    }
  }

  throw lastError || new Error('CAMERA_STREAM_NOT_AVAILABLE');
}

export async function requestBestAvailableStream() {
  let stream = await requestInitialStream();
  const devices = await listVideoDevicesSafe();
  const preferredDevice = pickBestCamera(devices);
  let finalTrack = stream.getVideoTracks()[0];
  const currentDeviceId = getTrackDeviceId(finalTrack);
  const shouldForcePreferredRearCamera =
    Boolean(preferredDevice) &&
    (
      currentDeviceId !== preferredDevice.deviceId ||
      isTrackLikelyFront(finalTrack)
    );

  if (shouldForcePreferredRearCamera) {
    try {
      const retryStream = await requestSpecificDeviceStream(preferredDevice.deviceId);
      stopTracks(stream);
      stream = retryStream;
      finalTrack = stream.getVideoTracks()[0];
    } catch (error) {
      console.warn('Nao foi possivel trocar para a camera traseira preferida.', error);
    }
  }

  if (isMobileDevice() && isTrackLikelyFront(finalTrack)) {
    stopTracks(stream);
    const rearCameraError = new Error('A camera traseira nao ficou disponivel neste navegador ou aparelho.');
    rearCameraError.name = 'RearCameraNotAvailableError';
    throw rearCameraError;
  }

  console.info('Camera selecionada para leitura.', {
    deviceId: getTrackDeviceId(finalTrack),
    facingMode: getTrackFacingMode(finalTrack),
    label: String(finalTrack?.label || ''),
    preferredDeviceId: String(preferredDevice?.deviceId || ''),
    rearConfirmed: isTrackLikelyRear(finalTrack),
    mobile: isMobileDevice()
  });

  await applyTrackTuning(finalTrack);

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

  if (name === 'RearCameraNotAvailableError') {
    return {
      type: 'rearCamera',
      text: 'Nao foi possivel confirmar a camera traseira. Em celular, abra o app por HTTPS e permita acesso a camera traseira.'
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError' || message.includes('Could not start video source')) {
    return { type: 'unavailable' };
  }

  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return {
      type: 'unavailable',
      text: 'A configuracao da camera nao foi aceita pelo aparelho. Tentamos um fallback, mas o video nao iniciou.'
    };
  }

  return { type: 'initError', text: `Detalhe: ${message}` };
}
