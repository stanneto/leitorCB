export function getFormatLabel(formatValue, formatLabels) {
  return formatLabels[formatValue] || String(formatValue || '');
}

function isDigitsOnly(text) {
  return /^[0-9]+$/.test(text);
}

function hasValidModulo10CheckDigit(text) {
  if (!isDigitsOnly(text) || text.length < 2) {
    return false;
  }

  let sum = 0;
  const checkDigit = Number(text[text.length - 1]);
  const body = text.slice(0, -1);
  const parityFromRight = body.length % 2;

  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[index]);
    sum += index % 2 === parityFromRight ? digit * 3 : digit;
  }

  return ((10 - (sum % 10)) % 10) === checkDigit;
}

function expandUpceToUpca(text) {
  if (!isDigitsOnly(text) || text.length !== 8) {
    return '';
  }

  const numberSystem = text[0];
  const manufacturer = text.slice(1, 6);
  const checkDigit = text[7];
  const lastDigit = manufacturer[4];
  let upcaBody = '';

  if (lastDigit === '0' || lastDigit === '1' || lastDigit === '2') {
    upcaBody = numberSystem + manufacturer.slice(0, 2) + lastDigit + '0000' + manufacturer.slice(2, 4);
  } else if (lastDigit === '3') {
    upcaBody = numberSystem + manufacturer.slice(0, 3) + '00000' + manufacturer[3];
  } else if (lastDigit === '4') {
    upcaBody = numberSystem + manufacturer.slice(0, 4) + '00000' + manufacturer[4];
  } else {
    upcaBody = numberSystem + manufacturer.slice(0, 5) + '0000' + lastDigit;
  }

  return upcaBody + checkDigit;
}

export function isSupportedFormat(formatName) {
  return (
    formatName === 'EAN-13' ||
    formatName === 'EAN-8' ||
    formatName === 'CODE-128' ||
    formatName === 'UPC-A' ||
    formatName === 'UPC-E' ||
    formatName === 'QR Code'
  );
}

export function isValidForFormat(text, formatName) {
  if (formatName === 'EAN-13') {
    return text.length === 13 && hasValidModulo10CheckDigit(text);
  }

  if (formatName === 'EAN-8') {
    return text.length === 8 && hasValidModulo10CheckDigit(text);
  }

  if (formatName === 'UPC-A') {
    return text.length === 12 && hasValidModulo10CheckDigit(text);
  }

  if (formatName === 'UPC-E') {
    return text.length === 8 && hasValidModulo10CheckDigit(expandUpceToUpca(text));
  }

  if (formatName === 'CODE-128') {
    if (!/^[\x20-\x7E]+$/.test(text) || text.length < 6) {
      return false;
    }

    if (/^\d{6,14}$/.test(text)) {
      return true;
    }

    return /^[A-Z0-9\-./ ]{6,24}$/i.test(text);
  }

  if (formatName === 'QR Code') {
    return text.length >= 4;
  }

  return true;
}

export function getRequiredConfirmationHits(formatName) {
  if (formatName === 'CODE-128') {
    return 2;
  }

  if (formatName === 'QR Code') {
    return 2;
  }

  return 1;
}
