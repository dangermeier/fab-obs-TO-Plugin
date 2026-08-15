const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'data', 'session.json');
const GEM_BASE = 'https://gem.fabtcg.com';

let session = null;
let loginInProgress = false;

function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      return session;
    }
  } catch {}
  return null;
}

function saveSession(data) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  session = data;
}

function getSession() { return session; }

function getCookieHeader() {
  if (!session?.sessionId) return '';
  return `sessionid=${session.sessionId}`;
}

function clearSession() {
  session = null;
  try { fs.unlinkSync(SESSION_FILE); } catch {}
}

function isLoginInProgress() { return loginInProgress; }

function findBrowser() {
  const candidates = [
    // Windows — Chrome
    process.env.PROGRAMFILES  && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA  && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    // Windows — Edge (always present on Win10/11)
    process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env.PROGRAMFILES  && `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    // Mac
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
  ].filter(Boolean);

  for (const p of candidates) {
    if (require('fs').existsSync(p)) return p;
  }
  return null;
}

// False in a container: no desktop browser to drive, so the config page points
// at the manual session cookie instead of offering a button that cannot work.
function canBrowserLogin() { return !!findBrowser(); }

async function launchGemLogin() {
  if (loginInProgress) throw new Error('Login already in progress');
  loginInProgress = true;

  let browser;
  try {
    const puppeteer    = require('puppeteer-core');
    const executablePath = findBrowser();
    if (!executablePath) {
      throw new Error('No Chrome or Edge installation found. Please install Google Chrome and try again.');
    }

    browser = await puppeteer.launch({
      executablePath,
      headless: false,
      defaultViewport: null,
      args: [
        '--window-size=1100,750',
        '--disable-blink-features=AutomationControlled'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });

    const [page] = await browser.pages();
    await page.goto(GEM_BASE, { waitUntil: 'domcontentloaded' });

    // Poll until sessionid cookie appears on a non-login page
    const TIMEOUT  = 5 * 60 * 1000; // 5 minutes
    const INTERVAL = 1500;
    const start    = Date.now();

    while (Date.now() - start < TIMEOUT) {
      // Check if browser was closed by the user
      if (!browser.connected) throw new Error('Browser was closed before login completed');

      const cookies = await page.cookies('https://gem.fabtcg.com');
      const sid     = cookies.find(c => c.name === 'sessionid');

      if (sid?.value && sid.value.length > 10) {
        const url = page.url();
        // Make sure we're not still on an auth/login page
        if (!url.includes('/accounts/') && !url.includes('/login') && !url.includes('/signup')) {
          await browser.close();
          browser = null;
          // Spread the old session: re-logging in mid-tournament (expired
          // cookie) must not drop the selected eventId and break every overlay.
          saveSession({ ...session, sessionId: sid.value, savedAt: Date.now() });
          return session;
        }
      }

      await new Promise(r => setTimeout(r, INTERVAL));
    }

    throw new Error('Login timed out after 5 minutes');
  } finally {
    loginInProgress = false;
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

async function setSessionCookie(sessionId) {
  const id = sessionId.trim();
  if (!id) throw new Error('Session ID cannot be empty');

  const res = await fetch(`${GEM_BASE}/profile/player/`, {
    headers: { Cookie: `sessionid=${id}`, Accept: 'text/html' },
    redirect: 'manual'
  });

  if (res.status === 302) throw new Error('Session ID is invalid or expired');
  if (res.status !== 200) throw new Error(`GEM returned HTTP ${res.status}`);

  // Spread the old session so a manually pasted cookie keeps the selected event.
  saveSession({ ...session, sessionId: id, savedAt: Date.now() });
  return session;
}

async function checkAuth() {
  if (!session?.sessionId) return false;
  try {
    const res = await fetch(`${GEM_BASE}/profile/player/`, {
      headers: { Cookie: getCookieHeader(), Accept: 'text/html' },
      redirect: 'manual'
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

module.exports = {
  loadSession, saveSession, getSession, getCookieHeader,
  clearSession, launchGemLogin, setSessionCookie, checkAuth, isLoginInProgress,
  canBrowserLogin
};
