(() => {
  const PAGE_SOURCE = "forgehub-lcsc-web";
  const EXTENSION_SOURCE = "forgehub-lcsc-extension";

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.source !== PAGE_SOURCE || typeof message.requestId !== "string") return;
    if (message.action !== "ping" && message.action !== "download" && message.action !== "choose-folder") return;

    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      window.postMessage({
        source: EXTENSION_SOURCE,
        requestId: message.requestId,
        action: `${message.action}-result`,
        ...(runtimeError ? { ok: false, error: runtimeError.message } : response),
      }, window.location.origin);
    });
  });
})();
