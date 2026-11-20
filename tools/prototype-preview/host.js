(() => {
  'use strict';
  const origins = document.querySelector('meta[name="app-origin"]').content.split(',').map((item) => item.trim()).filter(Boolean);
  const channel = new URLSearchParams(location.hash.slice(1)).get('channel');
  let payload, frame, resetting = false, accepted = false, notes = [], pending = null, annotate = false;
  const anchorInfo = new WeakMap();
  const send = (type, extra = {}) => {
    const message = { type, channel, ...extra };
    for (const origin of origins) parent.postMessage(message, origin);
  };
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2';
  document.body.appendChild(overlay);

  function cleanNotes(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 200).flatMap((note, index) => {
      if (!note || typeof note.id !== 'string' || note.id.length > 80) return [];
      const x = Number(note.x), y = Number(note.y);
      return [{
        id: note.id,
        selector: typeof note.selector === 'string' ? note.selector.slice(0, 400) : '',
        x: Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0,
        y: Number.isFinite(y) ? Math.min(1, Math.max(0, y)) : 0,
        n: Number.isInteger(note.n) && note.n > 0 ? note.n : index + 1,
        body: typeof note.body === 'string' ? note.body.slice(0, 1000) : '',
      }];
    });
  }
  function selectorFor(node, doc) {
    if (!node || node === doc.documentElement) return '';
    if (node === doc.body) return 'body';
    const parts = [];
    let current = node;
    while (current && current.parentElement && current !== doc.body && current !== doc.documentElement) {
      const siblings = [...current.parentElement.children].filter((child) => child.tagName === current.tagName);
      parts.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')');
      current = current.parentElement;
      if (parts.join(' > ').length > 400) break;
    }
    return parts.join(' > ').slice(0, 400);
  }
  function findAnchor(doc, selector) {
    if (!selector) return doc.scrollingElement || doc.documentElement;
    try { return doc.querySelector(selector); } catch { return null; }
  }
  function isScroller(element) {
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    const y = style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay';
    const x = style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'overlay';
    return (y && element.scrollHeight > element.clientHeight + 1) || (x && element.scrollWidth > element.clientWidth + 1);
  }
  function wouldSteal(element) {
    const view = element.ownerDocument.defaultView;
    for (const node of element.querySelectorAll('*')) {
      if (node.hasAttribute('data-fh-pin')) continue;
      const position = view.getComputedStyle(node).position;
      if (position !== 'absolute' && position !== 'fixed') continue;
      let parent = node.parentElement;
      let stolen = true;
      while (parent && parent !== element) {
        if (view.getComputedStyle(parent).position !== 'static') { stolen = false; break; }
        parent = parent.parentElement;
      }
      if (stolen) return true;
    }
    return false;
  }
  function mountFor(element) {
    let current = element;
    while (current) {
      if (!wouldSteal(current)) return current;
      current = current.parentElement;
    }
    return element;
  }
  function placePin(doc, note) {
    const element = findAnchor(doc, note.selector);
    if (!element) return;
    const mount = mountFor(element);
    const id = 'fh-pin-' + note.id;
    let pin = doc.getElementById(id);
    if (!pin) {
      pin = doc.createElement('div');
      pin.id = id;
      pin.setAttribute('data-fh-pin', '1');
      pin.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;margin:0;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#a33b24;color:#fff;font:700 12px/22px system-ui,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.25);transform:translate(-50%,-100%)';
    }
    pin.textContent = String(note.n);
    pin.title = note.body || '';
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      if (pin.parentElement !== mount) mount.appendChild(pin);
      return;
    }
    const view = doc.defaultView;
    if (view.getComputedStyle(mount).position === 'static') mount.style.position = 'relative';
    if (pin.parentElement !== mount) mount.appendChild(pin);
    if (mount === element) {
      if (isScroller(element)) {
        pin.style.left = (note.x * element.scrollWidth) + 'px';
        pin.style.top = (note.y * element.scrollHeight) + 'px';
      } else {
        pin.style.left = (note.x * 100) + '%';
        pin.style.top = (note.y * 100) + '%';
      }
      return;
    }
    const style = view.getComputedStyle(element);
    const mountStyle = view.getComputedStyle(mount);
    const mountRect = mount.getBoundingClientRect();
    const scrolling = isScroller(element);
    const pointX = rect.left + (parseFloat(style.borderLeftWidth) || 0) + note.x * (scrolling ? element.scrollWidth : element.clientWidth) - (scrolling ? element.scrollLeft : 0);
    const pointY = rect.top + (parseFloat(style.borderTopWidth) || 0) + note.y * (scrolling ? element.scrollHeight : element.clientHeight) - (scrolling ? element.scrollTop : 0);
    pin.style.left = (pointX - mountRect.left - (parseFloat(mountStyle.borderLeftWidth) || 0) + mount.scrollLeft) + 'px';
    pin.style.top = (pointY - mountRect.top - (parseFloat(mountStyle.borderTopWidth) || 0) + mount.scrollTop) + 'px';
  }
  function render() {
    const doc = frame?.contentDocument;
    if (!doc) return;
    const list = pending ? notes.concat(pending) : notes;
    const ids = new Set(list.map((note) => 'fh-pin-' + note.id));
    list.forEach((note) => placePin(doc, note));
    doc.querySelectorAll('[data-fh-pin]').forEach((pin) => { if (!ids.has(pin.id)) pin.remove(); });
  }
  function setAnnotate(enabled) {
    annotate = enabled;
    overlay.style.pointerEvents = enabled ? 'auto' : 'none';
    overlay.style.cursor = enabled ? 'crosshair' : '';
  }
  function pick(event) {
    if (!annotate || !frame?.contentDocument) return;
    event.preventDefault();
    event.stopPropagation();
    setAnnotate(false);
    const doc = frame.contentDocument;
    const frameRect = frame.getBoundingClientRect();
    const localX = event.clientX - frameRect.left;
    const localY = event.clientY - frameRect.top;
    let target = doc.elementFromPoint(localX, localY) || doc.body;
    const structural = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP', 'COL']);
    while (structural.has(target.tagName) && target.parentElement) target = target.parentElement;
    const rect = target.getBoundingClientRect();
    const style = doc.defaultView.getComputedStyle(target);
    const xIn = localX - rect.left - (parseFloat(style.borderLeftWidth) || 0);
    const yIn = localY - rect.top - (parseFloat(style.borderTopWidth) || 0);
    const scrolling = isScroller(target);
    const x = Math.min(1, Math.max(0, (xIn + (scrolling ? target.scrollLeft : 0)) / Math.max(scrolling ? target.scrollWidth : target.clientWidth, 1)));
    const y = Math.min(1, Math.max(0, (yIn + (scrolling ? target.scrollTop : 0)) / Math.max(scrolling ? target.scrollHeight : target.clientHeight, 1)));
    const selector = selectorFor(target, doc);
    pending = { id: 'draft', selector, x, y, n: notes.length + 1, body: '正在填写' };
    render();
    send('annotate-pick', { selector, x, y });
  }
  function focusNote(id) {
    const note = notes.find((item) => item.id === id);
    const doc = frame?.contentDocument;
    if (!note || !doc) return;
    const element = findAnchor(doc, note.selector);
    if (element && note.selector) element.scrollIntoView({ block: 'center', inline: 'nearest' });
    render();
  }
  overlay.addEventListener('click', pick);
  function anchorFrom(event) {
    const node = event.target instanceof Node ? event.target : null;
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    return element?.closest?.('a, area') || null;
  }
  function rememberAnchor(event) {
    const link = anchorFrom(event);
    if (!link) return;
    const href = link.getAttribute('href');
    const jump = link.getAttribute('data-fh-jump');
    if (href == null && jump == null) return;
    anchorInfo.set(link, {
      href: (href || '').trim(),
      jump,
      target: (link.getAttribute('target') || '').toLowerCase(),
    });
  }
  function jumpTo(doc, id) {
    let decoded = id;
    try { decoded = decodeURIComponent(id); } catch { /* keep the raw id */ }
    if (!decoded) {
      (doc.scrollingElement || doc.documentElement).scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    doc.getElementById(decoded)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function stayInDocument(event) {
    const link = anchorFrom(event);
    if (!link) return;
    const known = anchorInfo.get(link);
    const jump = link.getAttribute('data-fh-jump') ?? known?.jump;
    const href = (link.getAttribute('href') || known?.href || '').trim();
    const where = (link.getAttribute('target') || known?.target || '').toLowerCase();
    if (jump != null || href.startsWith('#')) {
      event.preventDefault();
      jumpTo(event.currentTarget, jump != null ? jump : href.slice(1));
      return;
    }
    const embedded = where === '_top' || where === '_parent';
    const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
    if (embedded || (href && !external)) event.preventDefault();
  }
  function disarmAnchors(doc) {
    for (const link of doc.querySelectorAll('a[href], area[href]')) {
      const href = (link.getAttribute('href') || '').trim();
      if (!href.startsWith('#')) continue;
      // Chrome drops a srcdoc fragment href before click listeners, then loads the preview host.
      link.setAttribute('data-fh-jump', href.slice(1));
      link.setAttribute('href', 'javascript:void(0)');
    }
  }
  function mount() {
    frame?.remove();
    const doc = new DOMParser().parseFromString(payload.html, 'text/html');
    const runtime = doc.createElement('script');
    runtime.src = location.origin + '/runtime.js';
    runtime.dataset.namespace = payload.namespace;
    // Bootstrap precedes prototype scripts; both storage APIs are namespaced.
    doc.head.prepend(runtime);
    disarmAnchors(doc);
    frame = document.createElement('iframe');
    frame.title = '交互原型';
    frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-downloads');
    frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
    frame.onload = () => {
      const inner = frame.contentDocument;
      if (inner) {
        inner.addEventListener('pointerdown', rememberAnchor, true);
        inner.addEventListener('mousedown', rememberAnchor, true);
        inner.addEventListener('focusin', rememberAnchor, true);
        inner.addEventListener('click', stayInDocument, true);
        new MutationObserver(() => render()).observe(inner.documentElement, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
      }
      render();
      send('loaded');
    };
    document.getElementById('status').hidden = true;
    document.body.appendChild(frame);
  }
  async function reset() {
    if (!payload || resetting) return;
    resetting = true;
    pending = null;
    frame?.remove(); frame = null;
    overlay.replaceChildren();
    try {
      const prefix = 'fh-proto:' + payload.namespace + ':';
      for (const store of [localStorage, sessionStorage]) {
        for (const key of Object.keys(store)) if (key.startsWith(prefix)) store.removeItem(key);
      }
      const names = await indexedDB.databases();
      await Promise.all(names.filter(db=>db.name?.startsWith(prefix)).map(db=>new Promise((resolve,reject)=>{
        const request = indexedDB.deleteDatabase(db.name);
        const timeout = setTimeout(()=>reject(Error('其他预览窗口正在使用数据，请关闭它们后重试')),5000);
        request.onsuccess=()=>{clearTimeout(timeout);resolve();};
        request.onerror=()=>{clearTimeout(timeout);reject(request.error);};
        request.onblocked=()=>{clearTimeout(timeout);reject(Error('请先关闭此版本的其他预览窗口，再重置'));};
      })));
      mount(); send('reset-done');
    } catch (error) { send('error',{message:error.message || '重置失败'}); }
    finally { resetting=false; }
  }
  addEventListener('resize', render);
  addEventListener('message',event=>{
    if(event.source===frame?.contentWindow && event.origin===location.origin && event.data?.type==='prototype-storage-error') {
      send('error',{message:'浏览器禁止了预览存储，保存功能不可用。请允许此预览站点的存储后重试。'}); return;
    }
    if(event.source!==parent || !origins.includes(event.origin) || event.data?.channel!==channel) return;
    if(event.data.type==='load' && !accepted && typeof event.data.html==='string' && event.data.html.length<=11*1024*1024 && /^[a-f0-9]{64}$/.test(event.data.namespace)) {
      accepted=true; payload=event.data; clearInterval(timer); mount();
    }
    if(event.data.type==='reset') void reset();
    if(event.data.type==='notes') {
      const cleaned = cleanNotes(event.data.notes);
      pending = cleaned.find((note) => note.id === 'draft') || null;
      notes = cleaned.filter((note) => note.id !== 'draft');
      render();
    }
    if(event.data.type==='annotate') setAnnotate(event.data.enabled === true);
    if(event.data.type==='focus-note' && typeof event.data.id==='string') focusNote(event.data.id);
  });
  const timer=setInterval(()=>{if(!accepted)send('ready');},500);
  send('ready');
})();
