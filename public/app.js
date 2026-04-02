(function () {
  'use strict';

  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');
  const diagnosticPanel = document.getElementById('diagnostic-panel');
  const diagnosticName = document.getElementById('diagnostic-name');
  const diagnosticMessage = document.getElementById('diagnostic-message');
  const startButton = document.getElementById('start-button');
  const stopButton = document.getElementById('stop-button');
  const torchButton = document.getElementById('torch-button');
  const retryButton = document.getElementById('retry-button');
  const closeButton = document.getElementById('close-button');
  const resultModal = document.getElementById('result-modal');
  const resultCode = document.getElementById('result-code');
  const resultNote = document.getElementById('result-note');
  const resultInlineCode = document.getElementById('result-inline-code');
  const videoStage = document.getElementById('video-stage');
  const previewVideo = document.getElementById('camera-preview');

  const ZXingApi = window.ZXingBrowser;
  const ZXingCore = window.ZXing || null;
  const BarcodeFormatEnum = (ZXingCore && ZXingCore.BarcodeFormat) || (ZXingApi && ZXingApi.BarcodeFormat) || null;
  const supportedFormats = BarcodeFormatEnum ? [
    BarcodeFormatEnum.EAN_13,
    BarcodeFormatEnum.EAN_8,
    BarcodeFormatEnum.CODE_128,
    BarcodeFormatEnum.UPC_A,
    BarcodeFormatEnum.UPC_E,
    BarcodeFormatEnum.QR_CODE
  ] : [];

  const statusCatalog = {
    idle: {
      pill: 'Pronto para leitura',
      text: 'Toque em Iniciar leitura para liberar a câmera e posicionar o codigo de barras na moldura.'
    },
    requesting: {
      pill: 'Solicitando câmera',
      text: 'Confirme a permissao no navegador para usar a câmera traseira.'
    },
    guiding: {
      pill: 'Posicione o codigo de barras',
      text: 'Centralize o codigo na area de leitura, mantenha boa iluminacao e aproxime ate ficar nitido.'
    },
    reading: {
      pill: 'Lendo codigo de barras',
      text: 'Segure o aparelho com firmeza por alguns instantes enquanto a leitura acontece.'
    },
    success: {
      pill: 'Codigo detectado',
      text: 'Leitura concluida com sucesso.'
    },
    timeout: {
      pill: 'Tempo de leitura encerrado',
      text: 'Nao encontramos um codigo dentro do tempo esperado. Toque em Ler novamente e tente outra distancia.'
    },
    insecure: {
      pill: 'HTTPS necessario',
      text: 'No iPhone, a câmera exige HTTPS ou localhost. Abra este app em https:// para testar de forma confiavel.'
    },
    denied: {
      pill: 'Permissao negada',
      text: 'Libere o acesso a câmera nas configuracoes do navegador e tente novamente.'
    },
    noCamera: {
      pill: 'Nenhuma câmera encontrada',
      text: 'Nao foi encontrada uma câmera disponivel neste aparelho.'
    },
    unavailable: {
      pill: 'Nao foi possivel acessar a câmera',
      text: 'Feche outros apps que estejam usando a câmera e tente novamente.'
    },
    initError: {
      pill: 'Falha ao iniciar video',
      text: 'O navegador nao conseguiu iniciar a visualizacao da câmera com seguranca.'
    },
    libraryError: {
      pill: 'Falha no leitor',
      text: 'A biblioteca de leitura nao conseguiu processar a câmera corretamente.'
    },
    libraryLoadError: {
      pill: 'Falha ao carregar leitor',
      text: 'Nao foi possivel carregar os arquivos do leitor ZXing. Recarregue a pagina e confirme se o servidor esta entregando /vendor/zxing-browser.min.js.'
    },
    libraryInitError: {
      pill: 'Falha ao iniciar leitor',
      text: 'O arquivo do ZXing foi entregue, mas a API do leitor nao ficou disponivel na pagina. Recarregue a pagina e tente novamente.'
    },
    stopped: {
      pill: 'Câmera parada',
      text: 'Toque em Iniciar leitura para abrir a câmera novamente.'
    }
  };

  statusCatalog.idle.text = '';

  const state = {
    reader: null,
    controls: null,
    stream: null,
    isStarting: false,
    isScanning: false,
    isStopping: false,
    timeoutId: 0,
    candidateText: '',
    candidateHits: 0,
    fatalDecodeHits: 0,
    lastAcceptedCode: '',
    lastAcceptedAt: 0,
    lastFailureNoticeAt: 0,
    scanActivatedAt: 0,
    scanLoopId: 0,
    scanAttemptCount: 0,
    captureCanvas: null,
    captureContext: null,
    torchAvailable: false,
    isTorchOn: false
  };

  const formatLabels = {};
  if (BarcodeFormatEnum) {
    formatLabels[BarcodeFormatEnum.EAN_13] = 'EAN-13';
    formatLabels[BarcodeFormatEnum.EAN_8] = 'EAN-8';
    formatLabels[BarcodeFormatEnum.CODE_128] = 'CODE-128';
    formatLabels[BarcodeFormatEnum.UPC_A] = 'UPC-A';
    formatLabels[BarcodeFormatEnum.UPC_E] = 'UPC-E';
    formatLabels[BarcodeFormatEnum.QR_CODE] = 'QR Code';
  }

  function createDecoderHints() {
    if (!ZXingCore || !ZXingCore.DecodeHintType) {
      return null;
    }

    const hints = new Map();
    hints.set(ZXingCore.DecodeHintType.TRY_HARDER, true);

    if (supportedFormats.length > 0) {
      hints.set(ZXingCore.DecodeHintType.POSSIBLE_FORMATS, supportedFormats);
    }

    return hints;
  }

  function isIosDevice() {
    const userAgent = window.navigator.userAgent || '';
    const platform = window.navigator.platform || '';
    const maxTouchPoints = window.navigator.maxTouchPoints || 0;

    return /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  }

  function normalizeUiText(text) {
    return String(text || '')
      .replace(/cÃ¢mera/g, 'câmera')
      .replace(/CÃ¢mera/g, 'Câmera')
      .replace(/\bcamera\b/g, 'câmera')
      .replace(/\bCamera\b/g, 'Câmera')
      .replace(/Conteudo/g, 'Conteúdo')
      .replace(/conteudo/g, 'conteúdo');
  }

  function setStatus(type, overrideText) {
    const content = statusCatalog[type] || statusCatalog.idle;
    const nextText = overrideText !== undefined ? overrideText : content.text;

    statusPill.textContent = normalizeUiText(content.pill);
    statusText.textContent = normalizeUiText(nextText);
    statusText.classList.toggle('hidden', !nextText);
  }

  function hideDiagnostic() {
    diagnosticName.textContent = '-';
    diagnosticMessage.textContent = '-';
    diagnosticPanel.classList.add('hidden');
  }

  function showDiagnostic(error, contextLabel) {
    const errorName = String(error && error.name ? error.name : 'Erro sem nome');
    const errorMessage = String(error && error.message ? error.message : error || 'Sem detalhes adicionais.');

    diagnosticName.textContent = contextLabel ? contextLabel + ': ' + errorName : errorName;
    diagnosticMessage.textContent = errorMessage;
    diagnosticPanel.classList.remove('hidden');
  }

  function setButtons() {
    startButton.disabled = state.isStarting || state.isScanning || !isEnvironmentReady();
    stopButton.disabled = !state.isScanning || state.isStopping;
    torchButton.disabled = !state.isScanning || state.isStopping || !state.torchAvailable;
    torchButton.textContent = state.isTorchOn ? 'Desligar lanterna' : 'Ligar a lanterna';
  }

  function isEnvironmentReady() {
    return Boolean(
      window.isSecureContext &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      window.ZXing &&
      window.ZXing.MultiFormatReader &&
      window.ZXingBrowser &&
      window.ZXingBrowser.BrowserMultiFormatReader
    );
  }

  async function diagnoseScannerLoad() {
    if (
      window.ZXing &&
      window.ZXing.MultiFormatReader &&
      window.ZXingBrowser &&
      window.ZXingBrowser.BrowserMultiFormatReader
    ) {
      return { type: 'ready' };
    }

    try {
      const targets = ['/vendor/zxing.min.js', '/vendor/zxing-browser.min.js'];

      for (const target of targets) {
        const response = await fetch(target, {
          method: 'GET',
          cache: 'no-store'
        });

        if (!response.ok) {
          return {
            type: 'libraryLoadError',
            text: 'O servidor respondeu ' + response.status + ' ao solicitar ' + target + '.'
          };
        }

        const contentType = String(response.headers.get('content-type') || '');
        if (contentType && !contentType.includes('javascript')) {
          return {
            type: 'libraryInitError',
            text: 'O arquivo ' + target + ' foi servido com Content-Type inesperado: ' + contentType + '.'
          };
        }
      }

      return { type: 'libraryInitError' };
    } catch (error) {
      return {
        type: 'libraryLoadError',
        text: 'Nao foi possivel baixar os arquivos do ZXing neste navegador. Detalhe: ' + String(error && error.message ? error.message : error)
      };
    }
  }

  function getFormatLabel(formatValue) {
    return formatLabels[formatValue] || String(formatValue || '');
  }

  function clearScanTimeout() {
    if (state.timeoutId) {
      window.clearTimeout(state.timeoutId);
      state.timeoutId = 0;
    }
  }

  function clearScanLoop() {
    if (state.scanLoopId) {
      window.clearTimeout(state.scanLoopId);
      state.scanLoopId = 0;
    }
  }

  function startScanTimeout() {
    clearScanTimeout();
    state.timeoutId = window.setTimeout(function () {
      if (!state.isScanning) {
        return;
      }

      stopScanner({ keepStatus: true }).then(function () {
        setStatus('timeout');
      }).catch(function (error) {
        console.error('Falha ao encerrar leitura por timeout.', error);
        setStatus('timeout');
      });
    }, 30000);
  }

  function resetDetectionBuffer() {
    state.candidateText = '';
    state.candidateHits = 0;
    state.fatalDecodeHits = 0;
    state.scanAttemptCount = 0;
  }

  function normalizeDecodedText(decodedText) {
    return String(decodedText || '').trim();
  }

  function isTransientDecodeError(error) {
    const errorName = String(error && error.name ? error.name : '');
    const errorMessage = String(error && error.message ? error.message : '').toLowerCase();
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

    const warmupWindowActive = state.scanActivatedAt > 0 && (Date.now() - state.scanActivatedAt) < 5000;
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

  function stopTracks(stream) {
    if (!stream) {
      return;
    }

    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  function clearVideoElement() {
    previewVideo.pause();
    previewVideo.removeAttribute('src');
    previewVideo.srcObject = null;
    previewVideo.load();
  }

  function getActiveVideoTrack() {
    return state.stream ? state.stream.getVideoTracks()[0] || null : null;
  }

  function prepareVideoElement() {
    previewVideo.setAttribute('autoplay', 'true');
    previewVideo.setAttribute('muted', 'true');
    previewVideo.setAttribute('playsinline', 'true');
    previewVideo.setAttribute('webkit-playsinline', 'true');
    previewVideo.muted = true;
    previewVideo.playsInline = true;
  }

  async function attachStreamToPreview(stream) {
    previewVideo.srcObject = stream;

    if (previewVideo.readyState < 1) {
      await new Promise(function (resolve) {
        function onLoadedMetadata() {
          previewVideo.removeEventListener('loadedmetadata', onLoadedMetadata);
          resolve();
        }

        previewVideo.addEventListener('loadedmetadata', onLoadedMetadata);
      });
    }

    await previewVideo.play();
  }

  function detectTorchAvailability() {
    const track = getActiveVideoTrack();

    if (!track || !track.getCapabilities) {
      return false;
    }

    try {
      const capabilities = track.getCapabilities();
      return Boolean(capabilities && capabilities.torch);
    } catch (error) {
      console.warn('Nao foi possivel verificar suporte a lanterna.', error);
      return false;
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
      .sort(function (left, right) {
        return scoreCameraLabel(right.label) - scoreCameraLabel(left.label);
      })[0];
  }

  async function listVideoDevicesSafe() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(function (device) {
        return device.kind === 'videoinput';
      });
    } catch (error) {
      console.warn('Nao foi possivel listar as cameras.', error);
      return [];
    }
  }

  function getPrimaryVideoConstraints() {
    return {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: isIosDevice() ? 1920 : 1280 },
        height: { ideal: isIosDevice() ? 1080 : 720 }
      }
    };
  }

  function getFallbackVideoConstraints() {
    return {
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
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
        await track.applyConstraints({ advanced: advanced });
      }
    } catch (error) {
      console.warn('Ajustes extras de foco/zoom nao puderam ser aplicados.', error);
    }
  }

  async function requestBestAvailableStream() {
    let stream;

    try {
      stream = await navigator.mediaDevices.getUserMedia(getPrimaryVideoConstraints());
    } catch (primaryError) {
      const primaryMessage = String(primaryError && primaryError.message ? primaryError.message : primaryError);

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
    const settings = videoTrack && videoTrack.getSettings ? videoTrack.getSettings() : {};
    const currentLabel = videoTrack ? videoTrack.label : '';
    const usingFrontCamera = String(settings.facingMode || '').toLowerCase() === 'user' || scoreCameraLabel(currentLabel) < 0;

    if (preferredDevice && usingFrontCamera) {
      try {
        const retryStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: preferredDevice.deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });

        stopTracks(stream);
        stream = retryStream;
      } catch (retryError) {
        console.warn('Nao foi possivel trocar para a camera traseira preferida.', retryError);
      }
    }

    const activeTrack = stream.getVideoTracks()[0];
    await applyTrackTuning(activeTrack);

    return stream;
  }

  function ensureCaptureCanvas(width, height) {
    if (!state.captureCanvas) {
      state.captureCanvas = document.createElement('canvas');
      state.captureContext = state.captureCanvas.getContext('2d', { willReadFrequently: true }) || state.captureCanvas.getContext('2d');
    }

    if (state.captureCanvas.width !== width) {
      state.captureCanvas.width = width;
    }

    if (state.captureCanvas.height !== height) {
      state.captureCanvas.height = height;
    }

    return state.captureCanvas;
  }

  function getDecodeRegions() {
    const frameWidth = previewVideo.videoWidth || 0;
    const frameHeight = previewVideo.videoHeight || 0;

    if (!frameWidth || !frameHeight) {
      return [];
    }

    const linearWide = {
      sx: Math.round(frameWidth * 0.05),
      sy: Math.round(frameHeight * 0.34),
      sw: Math.round(frameWidth * 0.90),
      sh: Math.round(frameHeight * 0.24)
    };

    const linearTall = {
      sx: Math.round(frameWidth * 0.08),
      sy: Math.round(frameHeight * 0.26),
      sw: Math.round(frameWidth * 0.84),
      sh: Math.round(frameHeight * 0.38)
    };

    const squareSize = Math.round(Math.min(frameWidth, frameHeight) * 0.72);
    const centerSquare = {
      sx: Math.round((frameWidth - squareSize) / 2),
      sy: Math.round((frameHeight - squareSize) / 2),
      sw: squareSize,
      sh: squareSize
    };

    return [linearWide, linearTall, centerSquare];
  }

  function drawDecodeRegion(region) {
    const targetWidth = Math.max(320, region.sw);
    const targetHeight = Math.max(160, region.sh);
    const canvas = ensureCaptureCanvas(targetWidth, targetHeight);

    state.captureContext.drawImage(
      previewVideo,
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

  function decodeCanvasWithReader(canvas) {
    const luminanceSource = new ZXingCore.HTMLCanvasElementLuminanceSource(canvas, true);
    const hybridBitmap = new ZXingCore.BinaryBitmap(new ZXingCore.HybridBinarizer(luminanceSource));

    try {
      return state.reader.decodeWithState(hybridBitmap);
    } catch (hybridError) {
      if (hybridError && (hybridError.name === 'NotFoundException' || hybridError.name === 'ChecksumException' || hybridError.name === 'FormatException')) {
        const histogramBitmap = new ZXingCore.BinaryBitmap(new ZXingCore.GlobalHistogramBinarizer(luminanceSource));
        return state.reader.decodeWithState(histogramBitmap);
      }

      throw hybridError;
    }
  }

  function decodeCurrentFrame() {
    const regions = getDecodeRegions();
    let lastError = null;

    for (const region of regions) {
      try {
        const canvas = drawDecodeRegion(region);
        const result = decodeCanvasWithReader(canvas);

        if (result) {
          return { result: result };
        }
      } catch (error) {
        lastError = error;
      }
    }

    return { error: lastError };
  }

  function scheduleScanLoop(delayMs) {
    clearScanLoop();

    if (!state.isScanning) {
      return;
    }

    state.scanLoopId = window.setTimeout(function () {
      runScanLoop().catch(function (error) {
        console.error('Falha no loop de leitura.', error);
        showDiagnostic(error, 'Loop');
        setStatus('libraryError', 'O leitor encontrou um erro ao analisar a imagem da camera.');
      });
    }, delayMs);
  }

  async function runScanLoop() {
    if (!state.isScanning) {
      return;
    }

    if (previewVideo.readyState < 2 || !previewVideo.videoWidth || !previewVideo.videoHeight) {
      scheduleScanLoop(120);
      return;
    }

    state.scanAttemptCount += 1;
    const outcome = decodeCurrentFrame();

    if (outcome.result) {
      state.fatalDecodeHits = 0;
      await finalizeSuccessfulRead(
        outcome.result.getText(),
        outcome.result.getBarcodeFormat ? getFormatLabel(outcome.result.getBarcodeFormat()) : ''
      );
      return;
    }

    if (outcome.error && !isTransientDecodeError(outcome.error)) {
      state.fatalDecodeHits += 1;

      if (state.fatalDecodeHits >= 3) {
        console.warn('Falha de leitura mantida, mas o scanner seguira tentando ate o timeout.', outcome.error);
        showDiagnostic(outcome.error, 'ZXing');
        setStatus('reading', 'O leitor ainda nao conseguiu decodificar o codigo. Ajuste distancia, foco e iluminacao; a tentativa continuara ate o tempo acabar.');
        state.fatalDecodeHits = 0;
      } else {
        updateGuidanceFromFailure();
      }
    } else {
      state.fatalDecodeHits = 0;
      updateGuidanceFromFailure();
    }

    scheduleScanLoop(90);
  }

  function updateGuidanceFromFailure() {
    const now = Date.now();
    if (now - state.lastFailureNoticeAt > 3500) {
      state.lastFailureNoticeAt = now;
      setStatus('guiding', 'Posicione o codigo de barras dentro da moldura e aguarde o foco ficar nitido.');
    }
  }

  function isValidDetectedCode(text) {
    return normalizeDecodedText(text).length > 0;
  }

  function isSupportedFormat(formatName) {
    return formatName === 'EAN-13' ||
      formatName === 'EAN-8' ||
      formatName === 'CODE-128' ||
      formatName === 'UPC-A' ||
      formatName === 'UPC-E' ||
      formatName === 'QR Code';
  }

  function playSuccessFeedback() {
    if (navigator.vibrate) {
      navigator.vibrate(90);
    }
  }

  function showResultModal(code, formatName) {
    resultCode.textContent = code;
    resultInlineCode.value = code;
    resultNote.textContent = formatName ? 'Formato detectado: ' + formatName : 'Leitura concluida com sucesso.';
    resultModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function hideResultModal() {
    resultModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  async function disposeScannerInternals() {
    clearScanTimeout();
    clearScanLoop();

    if (state.controls) {
      try {
        state.controls.stop();
      } catch (error) {
        console.warn('Falha ao encerrar os controles do scanner.', error);
      }
      state.controls = null;
    }

    if (state.stream) {
      stopTracks(state.stream);
      state.stream = null;
    }

    if (state.reader && state.reader.reset) {
      state.reader.reset();
    }

    state.reader = null;
    state.scanActivatedAt = 0;
    state.torchAvailable = false;
    state.isTorchOn = false;
    state.captureCanvas = null;
    state.captureContext = null;
    clearVideoElement();
    resetDetectionBuffer();
  }

  async function stopScanner(options) {
    const stopOptions = options || {};

    if (state.isStopping) {
      return;
    }

    state.isStopping = true;
    setButtons();

    try {
      await disposeScannerInternals();
      state.isScanning = false;
      state.isStarting = false;
      if (!stopOptions.keepStatus) {
        setStatus('stopped');
      }
    } finally {
      state.isStopping = false;
      setButtons();
    }
  }

  async function finalizeSuccessfulRead(text, formatName) {
    const normalized = normalizeDecodedText(text);
    const now = Date.now();

    if (!isValidDetectedCode(normalized) || !isSupportedFormat(formatName)) {
      return;
    }

    if (state.lastAcceptedCode === normalized && now - state.lastAcceptedAt < 4000) {
      return;
    }

    if (state.candidateText !== normalized) {
      state.candidateText = normalized;
      state.candidateHits = 1;
    } else {
      state.candidateHits += 1;
    }

    state.lastAcceptedCode = normalized;
    state.lastAcceptedAt = now;
    hideDiagnostic();
    setStatus('success', 'Codigo detectado: ' + normalized);
    await stopScanner({ keepStatus: true });
    playSuccessFeedback();
    showResultModal(normalized, formatName);
  }

  function describeCameraError(error) {
    const message = String(error && error.message ? error.message : error);
    const name = String(error && error.name ? error.name : '');

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
      return { type: 'unavailable', text: 'A configuracao da camera nao foi aceita pelo aparelho. Tentamos um fallback, mas a camera nao iniciou.' };
    }

    return { type: 'initError', text: 'Detalhe: ' + message };
  }

  async function startScanner() {
    if (state.isStarting || state.isScanning) {
      return;
    }

    hideResultModal();
    hideDiagnostic();
    await stopScanner({ keepStatus: true });
    state.isStarting = true;
    state.lastFailureNoticeAt = 0;
    setStatus('requesting');
    setButtons();

    if (!isEnvironmentReady()) {
      state.isStarting = false;
      setStatus('insecure');
      setButtons();
      return;
    }

    try {
      prepareVideoElement();
      const stream = await requestBestAvailableStream();
      await attachStreamToPreview(stream);

      if (!ZXingCore || !ZXingCore.MultiFormatReader) {
        throw new Error('O nucleo do ZXing nao ficou disponivel para processar os frames do video.');
      }

      const reader = new ZXingCore.MultiFormatReader();
      const hints = createDecoderHints();
      if (hints) {
        reader.setHints(hints);
      }

      state.stream = stream;
      state.reader = reader;
      setStatus('guiding');

      state.controls = null;
      state.torchAvailable = detectTorchAvailability();
      state.isTorchOn = false;
      state.isScanning = true;
      state.scanActivatedAt = Date.now();
      state.isStarting = false;
      setStatus('reading');
      startScanTimeout();
      scheduleScanLoop(120);
    } catch (error) {
      console.error('Falha ao iniciar o scanner.', error);
      showDiagnostic(error, 'Inicializacao');
      const cameraError = describeCameraError(error);
      state.isStarting = false;
      await disposeScannerInternals();
      setStatus(cameraError.type, cameraError.text);
    } finally {
      state.isStarting = false;
      setButtons();
    }
  }

  async function restartScanner() {
    hideResultModal();
    await stopScanner({ keepStatus: true });
    await startScanner();
  }

  async function toggleTorch() {
    const track = getActiveVideoTrack();

    if (!state.isScanning || !track || !track.applyConstraints || !state.torchAvailable) {
      return;
    }

    const nextTorchState = !state.isTorchOn;
    torchButton.disabled = true;

    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorchState }]
      });
      state.isTorchOn = nextTorchState;
    } catch (error) {
      console.warn('Nao foi possivel alternar a lanterna.', error);
      showDiagnostic(error, 'Lanterna');
      setStatus('reading', 'Nao foi possivel controlar a lanterna neste aparelho. A leitura pode continuar sem ela.');
    } finally {
      setButtons();
    }
  }

  window.addEventListener('beforeunload', function () {
    stopScanner({ keepStatus: true }).catch(function () {});
  });

  window.addEventListener('pagehide', function () {
    stopScanner({ keepStatus: true }).catch(function () {});
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopScanner({ keepStatus: true }).catch(function () {});
    }
  });

  startButton.addEventListener('click', function () {
    startScanner().catch(function (error) {
      console.error(error);
      setStatus('initError');
    });
  });

  stopButton.addEventListener('click', function () {
    stopScanner().catch(function (error) {
      console.error(error);
      setStatus('initError');
    });
  });

  torchButton.addEventListener('click', function () {
    toggleTorch().catch(function (error) {
      console.error(error);
      setStatus('initError');
    });
  });

  retryButton.addEventListener('click', function () {
    restartScanner().catch(function (error) {
      console.error(error);
      setStatus('initError');
    });
  });

  closeButton.addEventListener('click', function () {
    hideResultModal();
    hideDiagnostic();
    setStatus('idle');
  });

  async function initializePageState() {
    hideDiagnostic();

    if (!window.isSecureContext) {
      setStatus('insecure');
      setButtons();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('initError', 'Este navegador nao oferece suporte a captura de camera com getUserMedia.');
      setButtons();
      return;
    }

    if (
      !window.ZXing ||
      !window.ZXing.MultiFormatReader ||
      !window.ZXingBrowser ||
      !window.ZXingBrowser.BrowserMultiFormatReader
    ) {
      const diagnosis = await diagnoseScannerLoad();
      setStatus(diagnosis.type, diagnosis.text);
      setButtons();
      return;
    }

    setStatus('idle');
    setButtons();
  }

  initializePageState().catch(function (error) {
    console.error(error);
    showDiagnostic(error, 'Inicializacao');
    setStatus('libraryError', 'Nao foi possivel concluir a verificacao inicial do leitor.');
    setButtons();
  });
})();
