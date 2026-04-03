import React, { useEffect, useRef, useState } from 'react';
import { BarcodeFormat, DecodeHintType, MultiFormatReader } from '@zxing/library';
import {
  getFormatLabel,
  getRequiredConfirmationHits,
  isSupportedFormat,
  isValidForFormat
} from './barcodeUtils.js';
import { decodeCurrentFrame, isTransientDecodeError } from './scannerDecode.js';
import { describeCameraError, requestBestAvailableStream, stopTracks } from './scannerEnv.js';

const SUPPORTED_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.QR_CODE
];

const FORMAT_LABELS = {
  [BarcodeFormat.EAN_13]: 'EAN-13',
  [BarcodeFormat.EAN_8]: 'EAN-8',
  [BarcodeFormat.CODE_128]: 'CODE-128',
  [BarcodeFormat.UPC_A]: 'UPC-A',
  [BarcodeFormat.UPC_E]: 'UPC-E',
  [BarcodeFormat.QR_CODE]: 'QR Code'
};

const STATUS_CATALOG = {
  idle: {
    pill: 'Ative a câmera',
    text: ''
  },
  requesting: {
    pill: 'Solicitando câmera',
    text: 'Confirme a permissão no navegador para usar a câmera traseira.'
  },
  guiding: {
    pill: 'Posicione o código de barras',
    text: 'Centralize o código na moldura e aguarde o foco ficar nítido.'
  },
  reading: {
    pill: 'Lendo código de barras',
    text: 'Segure o aparelho com firmeza enquanto o leitor tenta identificar o código.'
  },
  success: {
    pill: 'Código detectado',
    text: 'Leitura concluída com sucesso.'
  },
  timeout: {
    pill: 'Tempo de leitura encerrado',
    text: 'Não encontramos um código dentro do tempo esperado. Toque em Ler novamente e tente outra distância.'
  },
  insecure: {
    pill: 'HTTPS necessário',
    text: 'No iPhone, a câmera exige HTTPS ou localhost. Abra este app em https:// para testar de forma confiável.'
  },
  denied: {
    pill: 'Permissão negada',
    text: 'Libere o acesso à câmera nas configurações do navegador e tente novamente.'
  },
  noCamera: {
    pill: 'Nenhuma câmera encontrada',
    text: 'Não foi encontrada uma câmera disponível neste aparelho.'
  },
  unavailable: {
    pill: 'Não foi possível acessar a câmera',
    text: 'Feche outros apps que estejam usando a câmera e tente novamente.'
  },
  initError: {
    pill: 'Falha ao iniciar vídeo',
    text: 'O navegador não conseguiu iniciar a visualização da câmera com segurança.'
  },
  libraryError: {
    pill: 'Falha no leitor',
    text: 'O leitor encontrou um erro inesperado durante a leitura. Tente novamente.'
  },
  stopped: {
    pill: 'Câmera parada',
    text: 'Toque em Iniciar leitura para abrir a câmera novamente.'
  }
};

function createDecoderHints() {
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
  return hints;
}

function createInitialUiState() {
  return {
    diagnostic: null,
    inlineCode: '',
    isResultModalOpen: false,
    isScanning: false,
    isStarting: false,
    isStopping: false,
    isTorchOn: false,
    resultCode: '',
    resultFormat: '',
    statusOverrideText: null,
    statusType: 'idle',
    torchAvailable: false
  };
}

function getStatusView(statusType, overrideText) {
  const catalogItem = STATUS_CATALOG[statusType] || STATUS_CATALOG.idle;

  return {
    pill: catalogItem.pill,
    text: overrideText !== null ? overrideText : catalogItem.text
  };
}

export default function App() {
  const videoRef = useRef(null);
  const runtimeRef = useRef({
    candidateHits: 0,
    candidateText: '',
    frameTimerId: 0,
    destroyed: false,
    fatalDecodeHits: 0,
    isScanning: false,
    isStarting: false,
    isStopping: false,
    lastAcceptedAt: 0,
    lastAcceptedCode: '',
    lastFailureNoticeAt: 0,
    reader: null,
    scanActivatedAt: 0,
    stream: null,
    timeoutId: 0,
    torchAvailable: false,
    torchOn: false
  });
  const [ui, setUi] = useState(createInitialUiState);

  function patchUi(patch) {
    if (!runtimeRef.current.destroyed) {
      setUi((previous) => ({ ...previous, ...patch }));
    }
  }

  function setStatus(statusType, overrideText = null) {
    patchUi({ statusType, statusOverrideText: overrideText });
  }

  function hideDiagnostic() {
    patchUi({ diagnostic: null });
  }

  function showDiagnostic(error, contextLabel) {
    const errorName = String(error?.name || 'Erro sem nome');
    const errorMessage = String(error?.message || error || 'Sem detalhes adicionais.');

    patchUi({
      diagnostic: {
        message: errorMessage,
        name: contextLabel ? `${contextLabel}: ${errorName}` : errorName
      }
    });
  }

  function resetDetectionBuffer() {
    const runtime = runtimeRef.current;
    runtime.candidateHits = 0;
    runtime.candidateText = '';
    runtime.fatalDecodeHits = 0;
  }

  function clearScanTimeout() {
    const runtime = runtimeRef.current;

    if (runtime.timeoutId) {
      window.clearTimeout(runtime.timeoutId);
      runtime.timeoutId = 0;
    }
  }

  function clearFrameTimer() {
    const runtime = runtimeRef.current;

    if (runtime.frameTimerId) {
      window.clearTimeout(runtime.frameTimerId);
      runtime.frameTimerId = 0;
    }
  }

  function clearVideoElement() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.pause();
    video.removeAttribute('src');
    video.srcObject = null;
    video.load();
  }

  function getActiveVideoTrack() {
    return runtimeRef.current.stream?.getVideoTracks?.()[0] || null;
  }

  function prepareVideoElement() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.setAttribute('autoplay', 'true');
    video.setAttribute('muted', 'true');
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.muted = true;
    video.playsInline = true;
  }

  function detectTorchAvailability() {
    const track = getActiveVideoTrack();

    if (!track || !track.getCapabilities) {
      return false;
    }

    try {
      return Boolean(track.getCapabilities()?.torch);
    } catch (error) {
      console.warn('Não foi possível verificar suporte à lanterna.', error);
      return false;
    }
  }

  async function disposeScannerInternals() {
    const runtime = runtimeRef.current;

    clearScanTimeout();
    clearFrameTimer();

    if (runtime.stream) {
      stopTracks(runtime.stream);
      runtime.stream = null;
    }

    runtime.reader?.reset?.();
    runtime.reader = null;
    runtime.scanActivatedAt = 0;
    runtime.torchAvailable = false;
    runtime.torchOn = false;
    clearVideoElement();
    resetDetectionBuffer();
  }

  async function stopScanner(options = {}) {
    const runtime = runtimeRef.current;

    if (runtime.isStopping) {
      return;
    }

    runtime.isStopping = true;
    patchUi({ isStopping: true });

    try {
      await disposeScannerInternals();
      runtime.isScanning = false;
      runtime.isStarting = false;
      patchUi({
        isScanning: false,
        isStarting: false,
        isStopping: false,
        isTorchOn: false,
        torchAvailable: false
      });

      if (!options.keepStatus) {
        setStatus('stopped');
      }
    } finally {
      runtime.isStopping = false;
      patchUi({ isStopping: false });
    }
  }

  function updateGuidanceFromFailure() {
    const runtime = runtimeRef.current;
    const now = Date.now();

    if (now - runtime.lastFailureNoticeAt > 3500) {
      runtime.lastFailureNoticeAt = now;
      setStatus('guiding', 'Posicione o código de barras dentro da moldura e aguarde o foco ficar nítido.');
    }
  }

  function getScanIntervalMs() {
    const userAgent = window.navigator.userAgent || '';
    const isIosLike = /iPhone|iPad|iPod/i.test(userAgent);

    return isIosLike ? 180 : 120;
  }

  function scheduleFrameDecode() {
    clearFrameTimer();

    runtimeRef.current.frameTimerId = window.setTimeout(() => {
      void runFrameDecode();
    }, getScanIntervalMs());
  }

  async function waitForVideoReadiness(video) {
    if (!video) {
      throw new Error('VIDEO_ELEMENT_NOT_FOUND');
    }

    const playAttempt = video.play();

    if (playAttempt && typeof playAttempt.then === 'function') {
      await playAttempt.catch(() => {});
    }

    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      return;
    }

    await new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('VIDEO_READY_TIMEOUT'));
      }, 4000);

      function cleanup() {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        video.removeEventListener('loadedmetadata', handleReady);
        video.removeEventListener('canplay', handleReady);
        video.removeEventListener('playing', handleReady);
      }

      function handleReady() {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          cleanup();
          resolve();
        }
      }

      video.addEventListener('loadedmetadata', handleReady);
      video.addEventListener('canplay', handleReady);
      video.addEventListener('playing', handleReady);
    });
  }

  async function runFrameDecode() {
    const runtime = runtimeRef.current;
    const video = videoRef.current;

    if (!runtime.isScanning || runtime.destroyed || !runtime.reader || !video) {
      return;
    }

    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      scheduleFrameDecode();
      return;
    }

    try {
      const { result, error } = decodeCurrentFrame(runtime.reader, runtime, video);

      if (result) {
        runtime.fatalDecodeHits = 0;
        await finalizeSuccessfulRead(
          result.getText(),
          result.getBarcodeFormat ? getFormatLabel(result.getBarcodeFormat(), FORMAT_LABELS) : ''
        );
        return;
      }

      handleDecodeFailure(error);
    } catch (error) {
      handleDecodeFailure(error);
    }

    if (runtimeRef.current.isScanning) {
      scheduleFrameDecode();
    }
  }

  async function finalizeSuccessfulRead(text, formatName) {
    const runtime = runtimeRef.current;
    const normalized = String(text || '').trim();
    const now = Date.now();

    if (!normalized || !isSupportedFormat(formatName) || !isValidForFormat(normalized, formatName)) {
      return;
    }

    if (runtime.lastAcceptedCode === normalized && now - runtime.lastAcceptedAt < 4000) {
      return;
    }

    if (runtime.candidateText !== normalized) {
      runtime.candidateText = normalized;
      runtime.candidateHits = 1;
    } else {
      runtime.candidateHits += 1;
    }

    if (runtime.candidateHits < getRequiredConfirmationHits(formatName)) {
      return;
    }

    runtime.lastAcceptedCode = normalized;
    runtime.lastAcceptedAt = now;
    hideDiagnostic();
    setStatus('success', `Código detectado: ${normalized}`);
    await stopScanner({ keepStatus: true });

    if (navigator.vibrate) {
      navigator.vibrate(90);
    }

    patchUi({
      inlineCode: normalized,
      isResultModalOpen: true,
      resultCode: normalized,
      resultFormat: formatName
    });
  }

  function handleDecodeFailure(error) {
    const runtime = runtimeRef.current;

    if (!error) {
      return;
    }

    if (isTransientDecodeError(error, runtime.scanActivatedAt)) {
      runtime.fatalDecodeHits = 0;
      updateGuidanceFromFailure();
      return;
    }

    runtime.fatalDecodeHits += 1;

    if (runtime.fatalDecodeHits >= 5) {
      showDiagnostic(error, 'ZXing');
      setStatus(
        'reading',
        'O leitor ainda não conseguiu decodificar o código. Ajuste distância, foco e iluminação; a tentativa continuará até o tempo acabar.'
      );
      runtime.fatalDecodeHits = 0;
      return;
    }

    updateGuidanceFromFailure();
  }

  function startScanTimeout() {
    clearScanTimeout();

    runtimeRef.current.timeoutId = window.setTimeout(() => {
      if (!runtimeRef.current.isScanning) {
        return;
      }

      void stopScanner({ keepStatus: true }).then(() => {
        setStatus('timeout');
      }).catch((error) => {
        console.error('Falha ao encerrar leitura por timeout.', error);
        setStatus('timeout');
      });
    }, 30000);
  }

  async function startScanner() {
    const runtime = runtimeRef.current;
    const video = videoRef.current;

    if (runtime.isStarting || runtime.isScanning || !video) {
      return;
    }

    patchUi({ isResultModalOpen: false });
    hideDiagnostic();
    await stopScanner({ keepStatus: true });

    runtime.isStarting = true;
    runtime.lastFailureNoticeAt = 0;
    patchUi({ isStarting: true });
    setStatus('requesting');

    if (!window.isSecureContext) {
      runtime.isStarting = false;
      patchUi({ isStarting: false });
      setStatus('insecure');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      runtime.isStarting = false;
      patchUi({ isStarting: false });
      setStatus('initError', 'Este navegador não oferece suporte a captura de câmera com getUserMedia.');
      return;
    }

    try {
      prepareVideoElement();
      const stream = await requestBestAvailableStream();
      const hints = createDecoderHints();
      const reader = new MultiFormatReader();
      reader.setHints(hints);
      const video = videoRef.current;

      runtime.stream = stream;
      runtime.reader = reader;
      runtime.isScanning = true;
      runtime.isStarting = false;
      runtime.scanActivatedAt = Date.now();
      runtime.torchAvailable = detectTorchAvailability();
      runtime.torchOn = false;

      patchUi({
        isScanning: true,
        isStarting: false,
        isTorchOn: false,
        torchAvailable: runtime.torchAvailable
      });
      setStatus('reading');
      if (video) {
        video.srcObject = stream;
        await waitForVideoReadiness(video);
      }
      startScanTimeout();
      scheduleFrameDecode();
    } catch (error) {
      console.error('Falha ao iniciar o scanner.', error);
      showDiagnostic(error, 'Inicialização');
      runtime.isStarting = false;
      patchUi({ isStarting: false });
      await disposeScannerInternals();
      const cameraError = describeCameraError(error);
      setStatus(cameraError.type, cameraError.text || null);
    }
  }

  async function restartScanner() {
    patchUi({ isResultModalOpen: false });
    await stopScanner({ keepStatus: true });
    await startScanner();
  }

  async function toggleTorch() {
    const runtime = runtimeRef.current;
    const track = getActiveVideoTrack();

    if (!runtime.isScanning || !track || !track.applyConstraints || !runtime.torchAvailable) {
      return;
    }

    const nextTorchState = !runtime.torchOn;
    patchUi({ torchAvailable: false });

    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorchState }]
      });
      runtime.torchOn = nextTorchState;
      patchUi({
        isTorchOn: nextTorchState,
        torchAvailable: true
      });
    } catch (error) {
      console.warn('Não foi possível alternar a lanterna.', error);
      showDiagnostic(error, 'Lanterna');
      setStatus('reading', 'Não foi possível controlar a lanterna neste aparelho. A leitura pode continuar sem ela.');
      patchUi({ torchAvailable: true });
    }
  }

  function closeResultModal() {
    patchUi({ isResultModalOpen: false });
    hideDiagnostic();
    setStatus('idle');
  }

  useEffect(() => {
    runtimeRef.current.destroyed = false;

    if (!window.isSecureContext) {
      setStatus('insecure');
      return () => {
        runtimeRef.current.destroyed = true;
      };
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('initError', 'Este navegador não oferece suporte a captura de câmera com getUserMedia.');
      return () => {
        runtimeRef.current.destroyed = true;
      };
    }

    setStatus('idle');

    return () => {
      runtimeRef.current.destroyed = true;
      void stopScanner({ keepStatus: true });
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('modal-open', ui.isResultModalOpen);

    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [ui.isResultModalOpen]);

  useEffect(() => {
    function stopSilently() {
      void stopScanner({ keepStatus: true });
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stopSilently();
      }
    }

    window.addEventListener('beforeunload', stopSilently);
    window.addEventListener('pagehide', stopSilently);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', stopSilently);
      window.removeEventListener('pagehide', stopSilently);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const statusView = getStatusView(ui.statusType, ui.statusOverrideText);
  const startDisabled = ui.isStarting || ui.isScanning || !window.isSecureContext;
  const stopDisabled = !ui.isScanning || ui.isStopping;
  const torchDisabled = !ui.isScanning || ui.isStopping || !ui.torchAvailable;

  return (
    <main className="app-shell">
      <section className="hero-card">
        <h1>Leitor de Código de Barras</h1>

        <div className="status-panel" aria-live="polite">
          {statusView.pill ? <span className="status-pill">{statusView.pill}</span> : null}
          {statusView.text ? <p className="status-text">{statusView.text}</p> : null}
          {ui.diagnostic ? (
            <div className="diagnostic-panel" aria-live="polite">
              <p className="diagnostic-title">Diagnóstico do leitor</p>
              <p className="diagnostic-line"><strong>Nome:</strong> {ui.diagnostic.name}</p>
              <p className="diagnostic-line"><strong>Mensagem:</strong> {ui.diagnostic.message}</p>
            </div>
          ) : null}
        </div>

        <div className="camera-card">
          <div className="video-stage">
            <video ref={videoRef} className="camera-preview" muted playsInline />
            <div className="scan-guide" aria-hidden="true">
              <div className="scan-frame" />
              <div className="scan-line" />
            </div>
          </div>
        </div>

        <div className="actions actions-scanner">
          <button className="button button-primary" type="button" onClick={() => void startScanner()} disabled={startDisabled}>
            Iniciar leitura
          </button>
          <button className="button button-secondary" type="button" onClick={() => void stopScanner()} disabled={stopDisabled}>
            Parar câmera
          </button>
          <button className="button button-secondary" type="button" onClick={() => void toggleTorch()} disabled={torchDisabled}>
            {ui.isTorchOn ? 'Desligar lanterna' : 'Ligar a lanterna'}
          </button>
        </div>
      </section>

      <section className="result-dock" aria-live="polite">
        <label className="result-inline-label" htmlFor="result-inline-code">Conteúdo lido</label>
        <input className="result-inline-input" id="result-inline-code" type="text" value={ui.inlineCode} readOnly />
      </section>

      {ui.isResultModalOpen ? (
        <div className="result-modal" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <div className="result-card">
            <p className="result-label">Código lido</p>
            <h2 id="result-title">Código lido</h2>
            <p className="result-copy">Valor detectado:</p>
            <p className="result-code">{ui.resultCode || '-'}</p>
            <p className="result-copy">
              {ui.resultFormat ? `Formato detectado: ${ui.resultFormat}` : 'Leitura concluída com sucesso.'}
            </p>
            <div className="actions actions-modal">
              <button className="button button-secondary" type="button" onClick={closeResultModal}>
                Fechar
              </button>
              <button className="button button-primary" type="button" onClick={() => void restartScanner()}>
                Ler novamente
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
