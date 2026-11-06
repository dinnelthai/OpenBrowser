const BRIDGE_URL = 'http://127.0.0.1:5000';

const PROVIDERS = [
  { name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  { name: 'Claude', hosts: ['claude.ai'] },
  { name: 'Perplexity', hosts: ['www.perplexity.ai', 'perplexity.ai'] },
  { name: 'GLM', hosts: ['chat.z.ai', 'glm.ai', 'open.bigmodel.cn'] },
  { name: 'Grok', hosts: ['grok.com', 'x.com'] },
  { name: 'Gemini', hosts: ['gemini.google.com'] },
  { name: 'DeepSeek', hosts: ['chat.deepseek.com'] },
];

const URL_PATTERNS = PROVIDERS.flatMap((provider) =>
  provider.hosts.map((host) => `https://${host}/*`),
);

const bridgeDot = document.querySelector('#bridge-dot');
const bridgeStatus = document.querySelector('#bridge-status');
const bridgeMeta = document.querySelector('#bridge-meta');
const pageDot = document.querySelector('#page-dot');
const pageHost = document.querySelector('#page-host');
const pageProvider = document.querySelector('#page-provider');
const providerList = document.querySelector('#provider-list');
const tabsSummary = document.querySelector('#tabs-summary');
const refreshButton = document.querySelector('#check');
const tokenInput = document.querySelector('#bridge-token');
const saveTokenButton = document.querySelector('#save-token');
const sendLocalAgentButton = document.querySelector('#send-local-agent');
const localAgentStatus = document.querySelector('#local-agent-status');

refreshButton.addEventListener('click', refreshStatus);
saveTokenButton.addEventListener('click', saveBridgeToken);
sendLocalAgentButton.addEventListener('click', sendLatestResponseToLocalAgent);
void loadBridgeToken();
refreshStatus();

async function refreshStatus() {
  bridgeStatus.textContent = 'Checking bridge...';
  setDot(bridgeDot, 'pending');

  const [bridgeOk, workerStatus, tabs, activeTab] = await Promise.all([
    checkBridge(),
    checkWorker(),
    chrome.tabs.query({ url: URL_PATTERNS }),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  if (bridgeOk && workerStatus?.sseConnected) {
    setDot(bridgeDot, 'online');
    bridgeStatus.textContent = 'Connected';
    bridgeMeta.textContent = `${BRIDGE_URL} · SSE active · ${workerStatus.readyTabs} tab(s)`;
  } else if (bridgeOk) {
    setDot(bridgeDot, 'pending');
    bridgeStatus.textContent = 'Bridge up, extension connecting...';
    bridgeMeta.textContent = `${BRIDGE_URL} · reload AI tab if jobs do not arrive`;
  } else {
    setDot(bridgeDot, 'offline');
    bridgeStatus.textContent = 'Offline';
    bridgeMeta.textContent = 'Run openbrowser in your project folder';
  }

  const activeHost = getHostname(activeTab[0]?.url);
  const activeProvider = findProvider(activeHost);

  if (activeProvider) {
    setDot(pageDot, bridgeOk ? 'online' : 'pending');
    pageHost.textContent = activeHost;
    pageProvider.textContent = `${activeProvider.name} detected`;
  } else if (activeHost) {
    setDot(pageDot, 'offline');
    pageHost.textContent = activeHost;
    pageProvider.textContent = 'Unsupported host';
  } else {
    setDot(pageDot, 'offline');
    pageHost.textContent = 'No active tab';
    pageProvider.textContent = 'Open an AI chat page';
  }

  renderProviders(tabs);
  tabsSummary.textContent = `${tabs.length} AI tab(s) open`;
}

async function checkBridge() {
  try {
    const started = performance.now();
    const response = await fetch(`${BRIDGE_URL}/health`);
    if (!response.ok) {
      return false;
    }
    const latency = Math.round(performance.now() - started);
    bridgeMeta.textContent = `${BRIDGE_URL} · ${latency}ms`;
    return true;
  } catch {
    return false;
  }
}

async function checkWorker() {
  try {
    return await chrome.runtime.sendMessage({ type: 'OPENBROWSER_PING' });
  } catch {
    return null;
  }
}

function renderProviders(tabs) {
  const openHosts = new Set(
    tabs.map((tab) => getHostname(tab.url)).filter(Boolean),
  );

  providerList.replaceChildren(
    ...PROVIDERS.map((provider) => {
      const item = document.createElement('li');
      const isOpen = provider.hosts.some((host) => openHosts.has(host));
      item.className = `provider-item ${isOpen ? 'open' : 'closed'}`;
      item.innerHTML = `
        <span class="dot ${isOpen ? 'online' : 'offline'}"></span>
        <span class="provider-name">${provider.name}</span>
        <span class="provider-host">${provider.hosts[0]}</span>
      `;
      return item;
    }),
  );
}

function findProvider(hostname) {
  if (!hostname) {
    return null;
  }
  return PROVIDERS.find((provider) => provider.hosts.includes(hostname)) ?? null;
}

function getHostname(url) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function setDot(element, state) {
  element.className = `dot ${state}`;
}


async function loadBridgeToken() {
  const stored = await chrome.storage.local.get('openbrowserBridgeToken');
  tokenInput.value = stored.openbrowserBridgeToken ?? '';
}

async function saveBridgeToken() {
  const token = tokenInput.value.trim();
  if (!token) {
    localAgentStatus.textContent = 'Enter the BRIDGE_TOKEN from your local .env file.';
    return;
  }
  await chrome.storage.local.set({ openbrowserBridgeToken: token });
  localAgentStatus.textContent = 'Token saved in this browser profile.';
}

async function sendLatestResponseToLocalAgent() {
  sendLocalAgentButton.disabled = true;
  localAgentStatus.textContent = 'Reading the latest assistant response...';
  try {
    const stored = await chrome.storage.local.get('openbrowserBridgeToken');
    const token = stored.openbrowserBridgeToken;
    if (!token) throw new Error('Save your BRIDGE_TOKEN first.');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !findProvider(getHostname(tab.url))) {
      throw new Error('Open a supported AI chat tab first.');
    }
    const extracted = await chrome.tabs.sendMessage(tab.id, { type: 'OPENBROWSER_EXPORT_LAST_RESPONSE' });
    if (!extracted?.content) throw new Error(extracted?.error ?? 'No assistant response found on this page.');

    const response = await fetch(`${BRIDGE_URL}/local-agent/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content: extracted.content,
        title: extracted.title || 'Task from ChatGPT',
        sourceUrl: tab.url,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Bridge request failed (${response.status})`);
    localAgentStatus.textContent = `Sent to local inbox · Task ${payload.task.id.slice(0, 8)} · review before execution.`;
  } catch (error) {
    localAgentStatus.textContent = String(error.message ?? error);
  } finally {
    sendLocalAgentButton.disabled = false;
  }
}
