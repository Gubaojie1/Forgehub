const NATIVE_HOST = "com.forgehub.lcsc_downloader";

function isForgeHubPage(url) {
  try {
    const parsed = new URL(url);
    return ["47.99.63.33", "hub.47.99.63.33.sslip.io", "localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab || !isForgeHubPage(sender.tab.url || "")) return;
  if (!message || message.source !== "forgehub-lcsc-web") return;

  if (message.action === "ping") {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "ping" }, (result) => {
      const runtimeError = chrome.runtime.lastError;
      sendResponse(runtimeError
        ? { ok: false, error: "本地下载助手未安装或未运行" }
        : (result || { ok: false, error: "本地下载助手没有响应" }));
    });
    return true;
  }

  if (message.action === "choose-folder") {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "choose-folder" }, (result) => {
      const runtimeError = chrome.runtime.lastError;
      sendResponse(runtimeError
        ? { ok: false, error: runtimeError.message || "本地下载助手未安装" }
        : (result || { ok: false, error: "本地下载助手没有响应" }));
    });
    return true;
  }

  if (message.action !== "download") return;
  if (typeof message.modelUuid !== "string" || !/^[a-z\d_-]{4,100}$/i.test(message.modelUuid)) {
    sendResponse({ ok: false, error: "无效的 3D 模型编号" });
    return;
  }

  chrome.runtime.sendNativeMessage(NATIVE_HOST, {
    action: "download",
    modelUuid: message.modelUuid,
    fileName: typeof message.fileName === "string" ? message.fileName : "component",
  }, (result) => {
    const runtimeError = chrome.runtime.lastError;
    sendResponse(runtimeError
      ? { ok: false, error: runtimeError.message || "本地下载助手未安装" }
      : (result || { ok: false, error: "本地下载助手没有响应" }));
  });
  return true;
});
