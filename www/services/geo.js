/* Camada unica de geolocalizacao — navegador ou plugin Capacitor.

   No app nativo (Capacitor) o navigator.geolocation nao devolve a posicao;
   e preciso do plugin @capacitor/geolocation (Workstream E). Enquanto
   GEOLOCATION_READY for false o plugin nao e carregado e o app usa
   navigator.geolocation normalmente. */

export const GEOLOCATION_READY = false;

const BROWSER_OPTIONS = { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 };

export function isNative() {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}

export function geolocationSupported() {
  return typeof navigator !== 'undefined' && !!navigator.geolocation;
}

/* Devolve { latitude, longitude }. Rejeita com err.code definido. */
export async function getCurrentPosition() {
  if (isNative() && GEOLOCATION_READY) {
    const result = await window.Capacitor.Plugins.Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 60000,
    });
    return {
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
    };
  }

  if (!geolocationSupported()) {
    throw new Error('Geolocalização do aparelho indisponível');
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      (error) => {
        const err = new Error(error?.message || 'Não foi possível acessar sua localização');
        err.code = error?.code;
        reject(err);
      },
      BROWSER_OPTIONS
    );
  });
}

export default { getCurrentPosition, geolocationSupported, isNative };
