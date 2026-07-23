export function openOAuthPopup(
  url: string,
  options?: { onComplete?: () => void; onStart?: () => void; title?: string }
): void {
  const width = 600;
  const height = 700;
  const left = window.screenX + (window.innerWidth - width) / 2;
  const top = window.screenY + (window.innerHeight - height) / 2;

  options?.onStart?.();

  const popup = window.open(
    url,
    options?.title || "Connect Account",
    `width=${width},height=${height},left=${left},top=${top},popup=1,resizable=1,scrollbars=1`
  );

  if (!popup) {
    window.location.href = url;
    return;
  }

  let lastSeenOrigin = false;
  const checkClosed = setInterval(() => {
    if (popup.closed) {
      clearInterval(checkClosed);
      options?.onComplete?.();
      return;
    }
    try {
      if (popup.location.host === window.location.host) {
        if (!lastSeenOrigin) {
          lastSeenOrigin = true;
        }
        popup.close();
        clearInterval(checkClosed);
        options?.onComplete?.();
      }
    } catch {
      // Cross-origin — expected while on provider's domain
    }
  }, 300);

  const closeTimeout = setTimeout(() => {
    clearInterval(checkClosed);
  }, 300000);
}
