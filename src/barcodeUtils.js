export function getFormatLabel(formatValue, formatLabels) {
  return formatLabels[formatValue] || String(formatValue || '');
}

export function isSupportedFormat(formatName) {
  return formatName === 'CODE-128' || formatName === 'OCR NUMERICO';
}

export function isValidForFormat(text, formatName) {
  if (formatName === 'CODE-128' || formatName === 'OCR NUMERICO') {
    return /^\d{8}$/.test(text);
  }

  return false;
}

export function getRequiredConfirmationHits(formatName) {
  if (formatName === 'CODE-128') {
    return 2;
  }

  if (formatName === 'OCR NUMERICO') {
    return 1;
  }

  return 0;
}
