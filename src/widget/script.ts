/**
 * Dependency-free browser widget. It deliberately lives in TypeScript as a
 * string so `tsc` includes it in the production server bundle—there is no
 * separate frontend asset pipeline to keep in sync.
 */
export const widgetScript = String.raw`(() => {
  const script = document.currentScript;
  const assistantId = script && script.dataset.assistant;
  if (!assistantId || !/^asst_[A-Za-z0-9_-]{20,}$/.test(assistantId)) {
    console.warn('[Ragbot] Add a valid data-assistant public ID to the widget script.');
    return;
  }

  const apiBase = (script.dataset.apiBase || new URL(script.src, window.location.href).origin).replace(/\/$/, '');
  const useStreaming = script.dataset.stream !== 'false';
  const storagePrefix = 'ragbot:' + assistantId + ':';
  const getStored = (key) => { try { return window.localStorage.getItem(storagePrefix + key); } catch { return null; } };
  const setStored = (key, value) => { try { window.localStorage.setItem(storagePrefix + key, value); } catch {} };
  const makeId = () => window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const visitorId = getStored('visitor') || makeId();
  setStored('visitor', visitorId);

  const host = document.createElement('div');
  host.setAttribute('data-ragbot-widget', assistantId);
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  const css = document.createElement('style');
  css.textContent = ':host { all: initial; }\n' +
    '.rb-wrap { --rb-primary: #2563eb; position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; }\n' +
    '.rb-launcher { width: 56px; height: 56px; float: right; border: 0; border-radius: 50%; background: var(--rb-primary); color: #fff; font-size: 25px; box-shadow: 0 8px 24px rgba(15, 23, 42, .24); cursor: pointer; }\n' +
    '.rb-panel { display: none; clear: both; width: min(370px, calc(100vw - 32px)); height: min(540px, calc(100vh - 100px)); margin-bottom: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 16px 48px rgba(15, 23, 42, .22); }\n' +
    '.rb-panel.rb-open { display: flex; flex-direction: column; } .rb-header { padding: 16px; background: var(--rb-primary); color: #fff; font-weight: 700; } .rb-messages { flex: 1; overflow-y: auto; padding: 14px; background: #f8fafc; }\n' +
    '.rb-message { max-width: 82%; padding: 10px 12px; margin: 8px 0; border-radius: 12px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.45; } .rb-bot { background: #fff; border: 1px solid #e2e8f0; border-bottom-left-radius: 3px; } .rb-user { margin-left: auto; background: var(--rb-primary); color: #fff; border-bottom-right-radius: 3px; }\n' +
    '.rb-sources { margin: -2px 0 10px; font-size: 12px; } .rb-sources a { color: var(--rb-primary); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .rb-form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e2e8f0; background: #fff; }\n' +
    '.rb-input { min-width: 0; flex: 1; border: 1px solid #cbd5e1; border-radius: 9px; padding: 10px; font: inherit; font-size: 14px; } .rb-send { border: 0; border-radius: 9px; background: var(--rb-primary); color: #fff; padding: 0 14px; font: inherit; cursor: pointer; } .rb-send:disabled, .rb-input:disabled { opacity: .55; cursor: not-allowed; }\n' +
    '@media (max-width: 480px) { .rb-wrap { right: 12px; bottom: 12px; } .rb-panel { width: calc(100vw - 24px); } }';
  const wrap = document.createElement('div');
  wrap.className = 'rb-wrap';
  const panel = document.createElement('section');
  panel.className = 'rb-panel';
  panel.setAttribute('aria-live', 'polite');
  const header = document.createElement('div'); header.className = 'rb-header'; header.textContent = 'Assistant';
  const messages = document.createElement('div'); messages.className = 'rb-messages';
  const form = document.createElement('form'); form.className = 'rb-form';
  const input = document.createElement('input'); input.className = 'rb-input'; input.placeholder = 'Type a message…'; input.maxLength = 4000; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Message');
  const send = document.createElement('button'); send.className = 'rb-send'; send.type = 'submit'; send.textContent = 'Send';
  form.append(input, send); panel.append(header, messages, form);
  const launcher = document.createElement('button'); launcher.className = 'rb-launcher'; launcher.type = 'button'; launcher.textContent = '💬'; launcher.setAttribute('aria-label', 'Open chat'); launcher.setAttribute('aria-expanded', 'false');
  wrap.append(panel, launcher); shadow.append(css, wrap);

  const scroll = () => { messages.scrollTop = messages.scrollHeight; };
  const bubble = (content, kind) => { const item = document.createElement('div'); item.className = 'rb-message rb-' + kind; item.textContent = content; messages.appendChild(item); scroll(); return item; };
  const showSources = (sources) => {
    if (!Array.isArray(sources) || !sources.length) return;
    const list = document.createElement('div'); list.className = 'rb-sources';
    for (const source of sources.slice(0, 5)) {
      try {
        const url = new URL(source.url);
        if (!/^https?:$/.test(url.protocol)) continue;
        const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = source.title || url.hostname; list.appendChild(link);
      } catch {}
    }
    if (list.childElementCount) { messages.appendChild(list); scroll(); }
  };
  const setBusy = (busy) => { input.disabled = busy; send.disabled = busy; };
  const primaryColor = (theme) => {
    const value = theme && typeof theme.primaryColor === 'string' ? theme.primaryColor.trim() : '';
    return /^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgb\([^)]+\)$/.test(value) ? value : '#2563eb';
  };

  launcher.addEventListener('click', () => {
    const open = panel.classList.toggle('rb-open');
    launcher.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  });

  async function sendStreaming(payload, botMessage) {
    const response = await fetch(apiBase + '/public/assistants/' + encodeURIComponent(assistantId) + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ ...payload, stream: true })
    });
    if (!response.ok || !response.body) throw new Error('The assistant is unavailable right now.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n'); buffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find((part) => part.startsWith('data:'));
        if (!line) continue;
        let data; try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (data.type === 'sources') showSources(data.sources);
        if (data.type === 'token') { botMessage.textContent += data.content || ''; scroll(); }
        if (data.type === 'done') { if (data.conversationId) setStored('conversation', data.conversationId); }
        if (data.type === 'error') throw new Error(data.message || 'The assistant could not complete the response.');
      }
    }
    if (!botMessage.textContent) botMessage.textContent = 'I could not find an answer right now.';
  }

  async function sendMessage(text) {
    bubble(text, 'user'); const botMessage = bubble('…', 'bot'); setBusy(true);
    const payload = { message: text, visitorId, conversationId: getStored('conversation') || undefined };
    try {
      if (useStreaming) await sendStreaming(payload, botMessage);
      else {
        const response = await fetch(apiBase + '/public/assistants/' + encodeURIComponent(assistantId) + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || 'The assistant is unavailable right now.');
        botMessage.textContent = data.answer || 'I could not find an answer right now.'; showSources(data.sources); if (data.conversationId) setStored('conversation', data.conversationId);
      }
    } catch (error) { botMessage.textContent = error instanceof Error ? error.message : 'Unable to send your message.'; }
    finally { setBusy(false); input.focus(); scroll(); }
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); const text = input.value.trim(); if (!text || input.disabled) return; input.value = ''; void sendMessage(text); });
  fetch(apiBase + '/public/assistants/' + encodeURIComponent(assistantId))
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('Widget configuration is unavailable.')))
    .then((data) => { const assistant = data.assistant || {}; header.textContent = assistant.name || 'Assistant'; wrap.style.setProperty('--rb-primary', primaryColor(assistant.theme)); bubble(assistant.welcomeMessage || 'Hi! How can I help?', 'bot'); })
    .catch((error) => { bubble(error instanceof Error ? error.message : 'Widget configuration is unavailable.', 'bot'); input.disabled = true; send.disabled = true; });
})();`;
