export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

export function on(target, eventName, handler, options) {
  target?.addEventListener(eventName, handler, options);
  return () => target?.removeEventListener(eventName, handler, options);
}

export function debounce(callback, wait = 250) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), wait);
  };
}

export function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

export function imageFileToDataUrl(file, options = {}) {
  const maxSize = Number(options.maxSize || 512);
  const quality = Number(options.quality || 0.86);

  return new Promise((resolve, reject) => {
    if (!file || !String(file.type).startsWith('image/')) {
      reject(new Error('Selecione uma imagem valida'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Nao foi possivel abrir a imagem'));
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
