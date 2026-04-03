import React, { useEffect, useRef, useState } from 'react';
import { BarcodeFormat, DecodeHintType, MultiFormatReader } from '@zxing/library';
import {
  getFormatLabel,
  getRequiredConfirmationHits,
  isSupportedFormat,
  isValidForFormat
} from './barcodeUtils.js';
import { decodeCurrentFrame, isTransientDecodeError } from './scannerDecode.js';
import {
  describeCameraError,
  isMobileDevice,
  requestBestAvailableStream,
  stopTracks
} from './scannerEnv.js';
import { terminateOcrWorker, tryRecognizeNumericOcr } from './ocrFallback.js';

const SUPPORTED_FORMATS = [
  BarcodeFormat.CODE_128
];

const FORMAT_LABELS = {
  [BarcodeFormat.CODE_128]: 'CODE-128'
};

const STATUS_CATALOG = {
  idle: {
    pill: 'Pronto para ler',
    text: 'Toque em Iniciar leitura para abrir a camera.'
  },
  requesting: {
    pill: 'Aguardando permissao',
    text: 'Confirme a permissao da camera no navegador.'
  },
  opening: {
    pill: 'Abrindo camera',
    text: 'Estamos preparando a camera e o video para iniciar a leitura.'
  },
  guiding: {
    pill: 'Posicione o codigo',
    text: 'Centralize o codigo Code 128 na moldura e espere a imagem ficar nitida.'
  },
  reading: {
    pill: 'Lendo Code 128',
    text: 'Mantenha o aparelho firme enquanto o ZXing tenta decodificar o codigo Code 128.'
  },
  ocr: {
    pill: 'Tentando OCR da numeracao',
    text: 'O leitor esta tentando reconhecer a numeracao visivel da etiqueta, sempre com 8 digitos.'
  },
  success: {
    pill: 'Codigo detectado com sucesso',
    text: 'Leitura concluida.'
  },
  timeout: {
    pill: 'Nenhum codigo detectado',
    text: 'Nao foi possivel detectar um codigo dentro do tempo esperado. Ajuste distancia, foco e iluminacao.'
  },
  insecure: {
    pill: 'HTTPS necessario',
    text: 'A camera em iPhone e em muitos navegadores moveis exige HTTPS ou localhost.'
  },
  denied: {
    pill: 'Permissao negada',
    text: 'Libere o acesso a camera nas configuracoes do navegador e tente novamente.'
  },
  noCamera: {
    pill: 'Nenhuma camera encontrada',
    text: 'Nao encontramos uma camera disponivel neste aparelho.'
  },
  rearCamera: {
    pill: 'Camera traseira nao disponivel',
    text: 'Nao foi possivel confirmar a camera traseira no celular. Abra o app por HTTPS e tente novamente.'
  },
  unavailable: {
    pill: 'Camera indisponivel',
    text: 'Feche outros apps que possam estar usando a camera e tente novamente.'
  },
  unsupported: {
    pill: 'Navegador nao suportado',
    text: 'Este navegador nao oferece getUserMedia ou recursos minimos para o leitor.'
  },
  initError: {
    pill: 'Falha ao iniciar video',
    text: 'O navegador nao conseguiu iniciar o video da camera com seguranca.'
  },
  stopped: {
    pill: 'Camera parada',
    text: 'Toque em Iniciar leitura para tentar novamente.'
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
    copyFeedback: '',
    diagnostic: null,
    inlineCode: '',
    isResultModalOpen: false,
    isScanning: false,
    isStarting: false,
    isStopping: false,
    isTorchOn: false,
    lastReadCode: '',
    lastReadFormat: '',
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

function getReadSourceLabel(formatName) {
  if (formatName === 'CODE-128') {
    return 'Lido por: Codigo de barras';
  }

  if (formatName === 'OCR NUMERICO') {
    return 'Lido por: OCR';
  }

  return 'Aguardando uma leitura valida.';
}

async function copyText(text) {
  const normalized = String(text || '').trim();

  if (!normalized) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalized);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = normalized;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  return copied;
}

export default function App() {
  const videoRef = useRef(null);
  const runtimeRef = useRef({
    audioContext: null,
    candidateHits: 0,
    candidateText: '',
    destroyed: false,
    fatalDecodeHits: 0,
    frameTimerId: 0,
    isScanning: false,
    isStarting: false,
    isStopping: false,
    lastAcceptedAt: 0,
    lastAcceptedCode: '',
    lastFailureNoticeAt: 0,
    lastOcrAttemptAt: 0,
    ocrInFlight: false,
    ocrWorker: null,
    readingStatusShown: false,
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
    patchUi({ statusOverrideText: overrideText, statusType });
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
    runtime.lastOcrAttemptAt = 0;
    runtime.readingStatusShown = false;
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
    video.setAttribute('disablePictureInPicture', 'true');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
  }

  function detectTorchAvailability() {
    const track = getActiveVideoTrack();

    if (!track || !track.getCapabilities) {
      return false;
    }

    try {
      return Boolean(track.getCapabilities()?.torch);
    } catch (error) {
      console.warn('Nao foi possivel verificar suporte a lanterna.', error);
      return false;
    }
  }

  async function playSuccessTone() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    try {
      const runtime = runtimeRef.current;

      if (!runtime.audioContext) {
        runtime.audioContext = new AudioContextCtor();
      }

      if (runtime.audioContext.state === 'suspended') {
        await runtime.audioContext.resume();
      }

      const oscillator = runtime.audioContext.createOscillator();
      const gain = runtime.audioContext.createGain();
      const now = runtime.audioContext.currentTime;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      oscillator.connect(gain);
      gain.connect(runtime.audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.12);
    } catch (error) {
      console.warn('Nao foi possivel emitir o tom de confirmacao.', error);
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
    runtime.ocrInFlight = false;
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
      setStatus('guiding', 'Posicione o codigo de barras dentro da moldura e aguarde o foco ficar nitido.');
    }
  }

  function getScanIntervalMs() {
    return isMobileDevice() ? 180 : 120;
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

    if (!runtime.readingStatusShown) {
      runtime.readingStatusShown = true;
      setStatus('reading');
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

  async function attemptOcrFallback() {
    const runtime = runtimeRef.current;
    const video = videoRef.current;

    if (
      !runtime.isScanning ||
      runtime.destroyed ||
      !video ||
      runtime.ocrInFlight ||
      Date.now() - runtime.scanActivatedAt < 3500
    ) {
      return;
    }

    try {
      setStatus('ocr');
      const ocrResult = await tryRecognizeNumericOcr(runtime, video);

      if (!ocrResult || !runtimeRef.current.isScanning) {
        return;
      }

      console.info('OCR numerico detectou um valor.', {
        confidence: ocrResult.confidence,
        text: ocrResult.text
      });

      await finalizeSuccessfulRead(ocrResult.text, 'OCR NUMERICO');
    } catch (error) {
      console.warn('Falha na tentativa de OCR.', error);
      showDiagnostic(error, 'OCR');
      setStatus('ocr', 'O OCR nao conseguiu reconhecer uma numeracao de 8 digitos nesta tentativa.');
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

    console.info('Codigo detectado.', {
      format: formatName,
      text: normalized
    });

    patchUi({
      copyFeedback: '',
      inlineCode: normalized,
      isResultModalOpen: true,
      lastReadCode: normalized,
      lastReadFormat: formatName,
      resultCode: normalized,
      resultFormat: formatName
    });

    hideDiagnostic();
    setStatus('success');
    await stopScanner({ keepStatus: true });

    if (navigator.vibrate) {
      navigator.vibrate(90);
    }

    await playSuccessTone();
  }

  function handleDecodeFailure(error) {
    const runtime = runtimeRef.current;

    if (!error) {
      return;
    }

    if (isTransientDecodeError(error, runtime.scanActivatedAt)) {
      runtime.fatalDecodeHits = 0;
      updateGuidanceFromFailure();
      void attemptOcrFallback();
      return;
    }

    runtime.fatalDecodeHits += 1;

    if (runtime.fatalDecodeHits >= 5) {
      showDiagnostic(error, 'ZXing');
      setStatus(
        'reading',
        'O leitor ainda nao conseguiu decodificar o Code 128. Ajuste distancia, foco e iluminacao; a tentativa vai continuar.'
      );
      runtime.fatalDecodeHits = 0;
      return;
    }

    updateGuidanceFromFailure();
    void attemptOcrFallback();
  }

  function startScanTimeout() {
    clearScanTimeout();

    runtimeRef.current.timeoutId = window.setTimeout(() => {
      if (!runtimeRef.current.isScanning) {
        return;
      }

      void stopScanner({ keepStatus: true })
        .then(() => {
          setStatus('timeout');
        })
        .catch((error) => {
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

    patchUi({ copyFeedback: '', isResultModalOpen: false });
    hideDiagnostic();
    await stopScanner({ keepStatus: true });

    runtime.isStarting = true;
    runtime.lastFailureNoticeAt = 0;
    runtime.readingStatusShown = false;
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
      setStatus('unsupported');
      return;
    }

    try {
      prepareVideoElement();
      const stream = await requestBestAvailableStream();
      const reader = new MultiFormatReader();
      const hints = createDecoderHints();

      reader.setHints(hints);

      runtime.stream = stream;
      runtime.reader = reader;
      runtime.isScanning = true;
      runtime.isStarting = false;
      runtime.scanActivatedAt = Date.now();
      runtime.torchAvailable = false;
      runtime.torchOn = false;

      patchUi({
        isScanning: true,
        isStarting: false,
        isTorchOn: false,
        torchAvailable: false
      });

      setStatus('opening');
      video.srcObject = stream;
      await waitForVideoReadiness(video);

      runtime.torchAvailable = detectTorchAvailability();
      patchUi({ torchAvailable: runtime.torchAvailable });

      console.info('Video pronto para leitura.', {
        label: String(stream.getVideoTracks?.()[0]?.label || ''),
        settings: stream.getVideoTracks?.()[0]?.getSettings?.() || {}
      });

      setStatus('guiding');
      startScanTimeout();
      scheduleFrameDecode();
    } catch (error) {
      console.error('Falha ao iniciar o scanner.', error);
      showDiagnostic(error, 'Inicializacao');
      runtime.isStarting = false;
      patchUi({ isStarting: false });
      await disposeScannerInternals();
      const cameraError = describeCameraError(error);
      setStatus(cameraError.type, cameraError.text || null);
    }
  }

  async function restartScanner() {
    patchUi({ copyFeedback: '', isResultModalOpen: false });
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
      console.warn('Nao foi possivel alternar a lanterna.', error);
      showDiagnostic(error, 'Lanterna');
      setStatus('reading', 'Nao foi possivel controlar a lanterna neste aparelho. A leitura pode continuar sem ela.');
      patchUi({ torchAvailable: true });
    }
  }

  async function handleCopyCode() {
    try {
      const copied = await copyText(ui.lastReadCode || ui.inlineCode || ui.resultCode);

      patchUi({
        copyFeedback: copied ? 'Codigo copiado.' : 'Nao foi possivel copiar o codigo automaticamente.'
      });
    } catch (error) {
      console.warn('Falha ao copiar codigo.', error);
      showDiagnostic(error, 'Copiar codigo');
      patchUi({ copyFeedback: 'Falha ao copiar o codigo.' });
    }
  }

  function closeResultModal() {
    patchUi({ copyFeedback: '', isResultModalOpen: false });

    if (ui.lastReadCode) {
      setStatus('success');
      return;
    }

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
      setStatus('unsupported');
      return () => {
        runtimeRef.current.destroyed = true;
      };
    }

    setStatus('idle');

    return () => {
      runtimeRef.current.destroyed = true;
      void stopScanner({ keepStatus: true });
      void terminateOcrWorker(runtimeRef.current);
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
  const displayedCode = ui.lastReadCode || ui.inlineCode || ui.resultCode || '';
  const displayedFormat = ui.lastReadFormat || ui.resultFormat || '';
  const startDisabled = ui.isStarting || ui.isScanning || !window.isSecureContext;
  const stopDisabled = !ui.isScanning || ui.isStopping;
  const torchDisabled = !ui.isScanning || ui.isStopping || !ui.torchAvailable;

  return (
    <main className="app-shell">
      <section className="hero-card">
        <h1>Leitor de Codigo de Barras</h1>

        <div className="status-panel" aria-live="polite">
          {statusView.pill ? <span className="status-pill">{statusView.pill}</span> : null}
          {statusView.text ? <p className="status-text">{statusView.text}</p> : null}
          {ui.diagnostic ? (
            <div className="diagnostic-panel" aria-live="polite">
              <p className="diagnostic-title">Diagnostico do leitor</p>
              <p className="diagnostic-line"><strong>Nome:</strong> {ui.diagnostic.name}</p>
              <p className="diagnostic-line"><strong>Mensagem:</strong> {ui.diagnostic.message}</p>
            </div>
          ) : null}
        </div>

        <div className="camera-card">
          <div className="video-stage">
            <video
              ref={videoRef}
              autoPlay
              className="camera-preview"
              disablePictureInPicture
              muted
              playsInline
            />
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
            Parar camera
          </button>
          <button className="button button-secondary" type="button" onClick={() => void toggleTorch()} disabled={torchDisabled}>
            {ui.isTorchOn ? 'Desligar lanterna' : 'Ligar lanterna'}
          </button>
        </div>
      </section>

      <section className="result-dock" aria-live="polite">
        <div className="result-inline-header">
          <p className="result-inline-label">Conteudo lido</p>
          <button
            className="button button-inline"
            type="button"
            onClick={() => void handleCopyCode()}
            disabled={!displayedCode}
          >
            Copiar codigo
          </button>
        </div>
        <div className="result-inline-value" role="status" aria-live="polite">
          {displayedCode || '-'}
        </div>
        <p className="result-inline-meta">
          {getReadSourceLabel(displayedFormat)}
        </p>
        {ui.copyFeedback ? <p className="result-inline-feedback">{ui.copyFeedback}</p> : null}
      </section>

      {ui.isResultModalOpen ? (
        <div className="result-modal" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <div className="result-card">
            <p className="result-label">Codigo lido</p>
            <h2 id="result-title">Leitura concluida</h2>
            <p className="result-copy">Valor detectado:</p>
            <p className="result-code">{ui.resultCode || '-'}</p>
            <p className="result-copy">
              {ui.resultFormat ? getReadSourceLabel(ui.resultFormat) : 'Leitura concluida com sucesso.'}
            </p>
            {ui.copyFeedback ? <p className="result-inline-feedback modal-feedback">{ui.copyFeedback}</p> : null}
            <div className="actions actions-modal">
              <button className="button button-secondary" type="button" onClick={() => void handleCopyCode()}>
                Copiar codigo
              </button>
              <button className="button button-primary" type="button" onClick={() => void restartScanner()}>
                Ler novamente
              </button>
              <button className="button button-secondary" type="button" onClick={closeResultModal}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
