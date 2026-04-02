(function () {
  'use strict';

  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');
  const startButton = document.getElementById('start-button');
  const stopButton = document.getElementById('stop-button');
  const retryButton = document.getElementById('retry-button');
  const copyButton = document.getElementById('copy-button');
  const resultModal = document.getElementById('result-modal');
  const resultCode = document.getElementById('result-code');
  const resultCopy = document.getElementById('result-copy');
  const resultInline = document.getElementById('result-inline');
  const resultInlineCode = document.getElementById('result-inline-code');
  const videoStage = document.getElementById('video-stage');

  const statusCatalog = {
    idle: {
      pill: 'Aguardando permissao da camera',
      text: ''
    },
    guiding: {
      pill: 'Posicione o codigo dentro da area de leitura',
      text: 'Mantenha a etiqueta centralizada, com boa iluminacao, e ajuste a distancia ate as barras ficarem nitidas.'
    },
    reading: {
      pill: 'Lendo...',
      text: 'Segure o aparelho com firmeza por alguns instantes para aumentar a confiabilidade da leitura.'
    },
    success: {
      pill: 'Codigo detectado com sucesso',
      text: 'A leitura foi pausada automaticamente para evitar duplicidade.'
    },
    empty: {
      pill: 'Nenhum codigo detectado',
      text: 'Tente aproximar ou afastar levemente a camera, reduzir reflexos e alinhar melhor a etiqueta.'
    },
    unsupported: {
      pill: 'Camera nao suportada neste navegador',
      text: 'Use um navegador moderno com acesso liberado a camera. Em muitos aparelhos, HTTP permite camera apenas em localhost.'
    },
    denied: {
      pill: 'Permissao de camera negada',
      text: 'Libere o acesso a camera nas configuracoes do navegador e tente novamente.'
    },
    unavailable: {
      pill: 'Camera indisponivel',
      text: 'Nao foi possivel acessar a camera traseira. Feche outros apps usando a camera e tente novamente.'
    },
    initError: {
      pill: 'Falha de inicializacao do video',
      text: 'O navegador nao conseguiu iniciar o video da camera com seguranca.'
    }
  };

  const supportedFormats = [
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.QR_CODE
  ];

  const state = {
    scanner: null,
    isStarting: false,
    isScanning: false,
    isStopping: false,
    preferredCameraId: '',
    readCooldownUntil: 0,
    lastFailureNoticeAt: 0,
    candidateText: '',
    candidateHits: 0,
    lastAcceptedCode: '',
    lastAcceptedAt: 0
  };

  function isIosDevice() {
    const userAgent = window.navigator.userAgent || '';
    const platform = window.navigator.platform || '';
    const maxTouchPoints = window.navigator.maxTouchPoints || 0;

    return /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  }

  function setStatus(type, overrideText) {
    const content = statusCatalog[type] || statusCatalog.idle;
    statusPill.textContent = content.pill;
    statusText.textContent = overrideText || content.text;
  }

  function setButtons() {
    startButton.disabled = state.isStarting || state.isScanning;
    stopButton.disabled = !state.isScanning || state.isStopping;
  }

  function isScannerSupported() {
    return Boolean(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.Html5Qrcode);
  }

  function getScannerVideoElement() {
    return videoStage.querySelector('video');
  }

  function tuneVideoElementForMobile() {
    const video = getScannerVideoElement();

    if (!video) {
      return;
    }

    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.muted = true;
    video.autoplay = true;
  }

  async function applyPlatformCameraTuning(scanner) {
    tuneVideoElementForMobile();

    if (!isIosDevice() || !scanner) {
      return;
    }

    try {
      const capabilities = scanner.getRunningTrackCapabilities();
      const advanced = [];

      if (capabilities && Array.isArray(capabilities.focusMode)) {
        if (capabilities.focusMode.includes('continuous')) {
          advanced.push({ focusMode: 'continuous' });
        } else if (capabilities.focusMode.includes('single-shot')) {
          advanced.push({ focusMode: 'single-shot' });
        }
      }

      if (capabilities && typeof capabilities.zoom === 'object' && typeof capabilities.zoom.max === 'number') {
        const minZoom = typeof capabilities.zoom.min === 'number' ? capabilities.zoom.min : 1;
        const maxZoom = capabilities.zoom.max;

        if (maxZoom > minZoom) {
          advanced.push({ zoom: Math.min(maxZoom, Math.max(minZoom, 1.8)) });
        }
      }

      if (advanced.length > 0) {
        await scanner.applyVideoConstraints({ advanced: advanced });
      }
    } catch (error) {
      console.warn('Nao foi possivel aplicar ajustes extras de camera para iPhone.', error);
    }
  }

  function resetDetectionBuffer() {
    state.candidateText = '';
    state.candidateHits = 0;
  }

  function normalizeDecodedText(decodedText) {
    return String(decodedText || '').trim();
  }

  function stopStream(stream) {
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

    if (normalized.includes('back') || normalized.includes('rear') || normalized.includes('traseira')) {
      score += 8;
    }

    if (normalized.includes('environment')) {
      score += 6;
    }

    if (normalized.includes('wide')) {
      score += 2;
    }

    if (normalized.includes('front') || normalized.includes('frontal') || normalized.includes('user')) {
      score -= 10;
    }

    return score;
  }

  function pickBestCamera(cameras) {
    if (!Array.isArray(cameras) || cameras.length === 0) {
      return null;
    }

    const ranked = cameras
      .map(function (camera) {
        return {
          camera: camera,
          score: scoreCameraLabel(camera.label)
        };
      })
      .sort(function (left, right) {
        return right.score - left.score;
      });

    return ranked[0].camera;
  }

  async function preparePreferredCamera() {
    let permissionProbeStream = null;

    try {
      permissionProbeStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      const cameras = await Html5Qrcode.getCameras();
      const preferredCamera = pickBestCamera(cameras);

      state.preferredCameraId = preferredCamera ? preferredCamera.id : '';
    } finally {
      stopStream(permissionProbeStream);
    }
  }

  function isLikelyAssetCode(decodedText, result) {
    const formatName = result && result.result && result.result.format ? result.result.format.formatName : '';
    const normalized = normalizeDecodedText(decodedText);

    if (!normalized) {
      return false;
    }

    if (formatName === 'CODE_128' && /^\d{6,12}$/.test(normalized)) {
      return true;
    }

    return normalized.length >= 6;
  }

  function updateGuidanceFromFailure() {
    const now = Date.now();
    if (now - state.lastFailureNoticeAt > 3500) {
      state.lastFailureNoticeAt = now;
      setStatus('empty');
    }
  }

  function playSuccessFeedback() {
    if (navigator.vibrate) {
      navigator.vibrate(90);
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    try {
      const audioContext = new AudioContextClass();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const currentTime = audioContext.currentTime;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(987, currentTime);
      gain.gain.setValueAtTime(0.001, currentTime);
      gain.gain.exponentialRampToValueAtTime(0.05, currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.16);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(currentTime);
      oscillator.stop(currentTime + 0.16);
      oscillator.onended = function () {
        audioContext.close().catch(function () {});
      };
    } catch (error) {
      console.warn('Nao foi possivel tocar o som de confirmacao.', error);
    }
  }

  function showResultModal(code) {
    resultCode.textContent = code;
    resultInlineCode.textContent = code;
    resultInline.classList.remove('hidden');
    resultCopy.textContent = 'O scanner foi pausado para evitar leituras duplicadas. Copie o valor ou inicie uma nova leitura.';
    resultModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function hideResultModal() {
    resultModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  async function stopScanner() {
    if (!state.scanner || !state.isScanning || state.isStopping) {
      state.isScanning = false;
      state.isStopping = false;
      setButtons();
      return;
    }

    state.isStopping = true;
    setButtons();

    try {
      await state.scanner.stop();
      state.scanner.clear();
    } catch (error) {
      console.warn('Falha ao interromper o scanner.', error);
    } finally {
      state.scanner = null;
      state.isScanning = false;
      state.isStopping = false;
      setButtons();
    }
  }

  async function handleSuccess(decodedText, result) {
    const code = normalizeDecodedText(decodedText);
    const now = Date.now();
    const formatName = result && result.result && result.result.format ? result.result.format.formatName : '';

    if (!isLikelyAssetCode(code, result)) {
      return;
    }

    if (state.lastAcceptedCode === code && now - state.lastAcceptedAt < 4000) {
      return;
    }

    if (state.candidateText !== code) {
      state.candidateText = code;
      state.candidateHits = 1;
      return;
    }

    state.candidateHits += 1;

    if (state.candidateHits < 2 && formatName === 'CODE_128') {
      return;
    }

    if (state.candidateHits < 3 && formatName !== 'CODE_128') {
      return;
    }

    state.lastAcceptedCode = code;
    state.lastAcceptedAt = now;
    state.readCooldownUntil = now + 4000;
    resetDetectionBuffer();
    setStatus('success', 'Conteudo lido: ' + code);
    await stopScanner();
    playSuccessFeedback();
    showResultModal(code);
  }

  function handleFailure() {
    const now = Date.now();

    if (now < state.readCooldownUntil) {
      return;
    }

    if (state.isScanning) {
      updateGuidanceFromFailure();
    }
  }

  async function ensureCameraPermission() {
    if (!navigator.permissions || !navigator.permissions.query) {
      return;
    }

    try {
      const permissionStatus = await navigator.permissions.query({ name: 'camera' });
      if (permissionStatus.state === 'denied') {
        throw new Error('PERMISSION_DENIED');
      }
    } catch (error) {
      if (error.message === 'PERMISSION_DENIED') {
        throw error;
      }
    }
  }

  function createScanner() {
    if (!state.scanner) {
      state.scanner = new Html5Qrcode('reader', {
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: false
        },
        formatsToSupport: supportedFormats,
        verbose: false
      });
    }

    return state.scanner;
  }

  async function startScannerWithConfig(cameraConfig, scanConfig, guidanceText) {
    const scanner = createScanner();
    await scanner.start(cameraConfig, scanConfig, handleSuccess, handleFailure);
    await applyPlatformCameraTuning(scanner);
    state.isScanning = true;
    setStatus('reading', guidanceText);
  }

  async function startScanner() {
    if (state.isStarting || state.isScanning) {
      return;
    }

    hideResultModal();
    resetDetectionBuffer();
    state.lastFailureNoticeAt = 0;
    state.isStarting = true;
    setStatus('guiding');
    setButtons();

    if (!isScannerSupported()) {
      state.isStarting = false;
      setStatus('unsupported');
      setButtons();
      return;
    }

    try {
      await ensureCameraPermission();
      await preparePreferredCamera();
      const stageWidth = Math.min(videoStage.clientWidth || window.innerWidth, 420);
      const stageHeight = Math.min(videoStage.clientHeight || Math.round(window.innerHeight * 0.72), 560);
      const qrBoxFactory = function (viewfinderWidth, viewfinderHeight) {
        const width = Math.min(viewfinderWidth * 0.82, 340);
        const height = Math.min(viewfinderHeight * 0.26, 160);
        return {
          width: Math.max(220, Math.round(width)),
          height: Math.max(96, Math.round(height))
        };
      };

      await startScannerWithConfig(
        state.preferredCameraId || { facingMode: { ideal: 'environment' } },
        {
          aspectRatio: stageWidth / stageHeight,
          disableFlip: false,
          fps: 10,
          qrbox: qrBoxFactory,
          videoConstraints: {
            facingMode: { ideal: 'environment' },
            width: { ideal: isIosDevice() ? 1920 : 1280 },
            height: { ideal: isIosDevice() ? 1080 : 720 }
          }
        }
      );
    } catch (error) {
      console.error('Falha ao iniciar a leitura.', error);
      const message = String(error && error.message ? error.message : error);

      if (message.includes('Permission denied') || message.includes('NotAllowedError') || message === 'PERMISSION_DENIED') {
        setStatus('denied');
      } else if (message.includes('NotFoundError') || message.includes('OverconstrainedError')) {
        try {
          await startScannerWithConfig(
            { facingMode: 'environment' },
            {
              disableFlip: false,
              fps: 10,
              qrbox: { width: 300, height: 120 },
              videoConstraints: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 }
              }
            },
            'A camera traseira foi selecionada por preferencia. Se a leitura falhar, confira se outra camera nao foi aberta.'
          );
        } catch (fallbackError) {
          console.error('Falha no fallback da camera.', fallbackError);
          setStatus('unavailable');
        }
      } else if (message.includes('NotReadableError') || message.includes('AbortError')) {
        setStatus('unavailable');
      } else {
        setStatus('initError');
      }
    } finally {
      state.isStarting = false;
      setButtons();
    }
  }

  async function copyCode() {
    const code = resultCode.textContent.trim();

    if (!code || code === '-') {
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      resultCopy.textContent = 'Codigo copiado para a area de transferencia.';
    } catch (error) {
      console.warn('Falha ao copiar com a API de clipboard.', error);

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(resultCode);
      selection.removeAllRanges();
      selection.addRange(range);

      try {
        document.execCommand('copy');
        resultCopy.textContent = 'Codigo copiado para a area de transferencia.';
      } catch (copyError) {
        resultCopy.textContent = 'Nao foi possivel copiar automaticamente. Selecione o codigo manualmente.';
      }

      selection.removeAllRanges();
    }
  }

  async function restartScanner() {
    hideResultModal();
    await stopScanner();
    setStatus('guiding');
    await startScanner();
  }

  window.addEventListener('beforeunload', function () {
    stopScanner().catch(function () {});
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopScanner().catch(function () {});
    }
  });

  startButton.addEventListener('click', function () {
    startScanner().catch(function (error) {
      console.error(error);
      setStatus('initError');
    });
  });

  stopButton.addEventListener('click', function () {
    stopScanner().then(function () {
      setStatus('idle');
    });
  });

  retryButton.addEventListener('click', function () {
    restartScanner().catch(function (error) {
      console.error(error);
      setStatus('initError');
    });
  });

  copyButton.addEventListener('click', function () {
    copyCode().catch(function () {
      resultCopy.textContent = 'Nao foi possivel copiar automaticamente. Selecione o codigo manualmente.';
    });
  });

  if (!window.isSecureContext) {
    setStatus('unsupported', 'No iPhone, a camera so funciona de forma confiavel em HTTPS ou localhost. Gere um certificado local e abra o leitor em https://.');
    startButton.disabled = true;
  } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('unsupported');
    startButton.disabled = true;
  } else {
    setStatus('idle');
  }

  setButtons();
})();
