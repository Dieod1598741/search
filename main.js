const { app, BrowserWindow, session } = require('electron');
const { createServer } = require('http');
const next = require('next');
const crypto = require('crypto');

// Packaged 환경(exe)에서는 isPackaged가 true가 됩니다.
const dev = !app.isPackaged;

// Secure Environment Injection (Obfuscated)
if (!dev) {
  function __d(e, k, v) {
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(k, 'hex'), Buffer.from(v, 'hex'));
    let decrypted = decipher.update(Buffer.from(e, 'hex'));
    return Buffer.concat([decrypted, decipher.final()]).toString();
  }

  const _k = '1b0391375ed75771399f093e46e672780b2e1fa6d27fea783e341aa6ebf1e905';
  const _v = '4e94fb390f6c30069896ef5c6f6e4349';

  process.env.DATABASE_URL = __d('98b86b149172206a84d6de63dc6d143df1eb8eb9283976aca0d4a371ff70aaa1961679aa750add3949d0bca20cccb064ebb9527af784a37a7308c6339f455f2a66539bc3087f2175270227649965141225a20afd2daa42ebf24915f8ae03d5a1613bfdd4eaeb58369f94060c7b65fc0271a828ea2f827363432139e3d35b1fed', _k, _v);
  process.env.DIRECT_URL = __d('98b86b149172206a84d6de63dc6d143df1eb8eb9283976aca0d4a371ff70aaa1961679aa750add3949d0bca20cccb064ebb9527af784a37a7308c6339f455f2a66539bc3087f2175270227649965141225a20afd2daa42ebf24915f8ae03d5a1ace7fb03df1d8d5c9622efb3043f6b2a', _k, _v);

  // Packaged app runs with process.cwd() as the executable folder (e.g. C:\Program Files\SEARCH)
  // We must change it to __dirname (resources/app) so Next.js can resolve node_modules
  process.chdir(__dirname);
}

const nextApp = next({ dev, dir: __dirname });
const handle = nextApp.getRequestHandler();

const SHOPPING_PARTITION = 'persist:shopping';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let mainWindow;

/**
 * Detects whether a loaded page is asking for CAPTCHA / human verification / bot block.
 * We NEVER attempt to solve or bypass bot checks; instead we report `blocked: true`
 * so the user can open a normal visible session window if they wish to verify themselves.
 */
function detectBlockedPage(html, finalUrl) {
  if (!html || html.length < 400) return true;
  if (/nidlogin|captcha|verify|access\s*denied/i.test(finalUrl || '')) return true;
  const lower = html.toLowerCase();
  if (
    lower.includes('로봇이 아닙니다') ||
    lower.includes('비정상적인 접근') ||
    lower.includes('접근이 제한') ||
    lower.includes('자동입력 방지') ||
    lower.includes('access denied') ||
    lower.includes('cf-turnstile') ||
    lower.includes('g-recaptcha')
  ) {
    return true;
  }
  return false;
}

app.whenReady().then(() => {
  // Configure persistent shopping session once
  const shoppingSession = session.fromPartition(SHOPPING_PARTITION);
  shoppingSession.setUserAgent(USER_AGENT);

  nextApp.prepare().then(() => {
    /**
     * Background scraper using persistent user session (preserves normal cookies & preferences).
     */
    async function scrapeWithPersistentSession(url) {
      return new Promise((resolve, reject) => {
        const win = new BrowserWindow({
          show: false,
          width: 1280,
          height: 900,
          webPreferences: {
            partition: SHOPPING_PARTITION,
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        let settled = false;
        const finish = (err, payload) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (!win.isDestroyed()) win.destroy();
          if (err) reject(err);
          else resolve(payload);
        };

        const timeout = setTimeout(() => {
          finish(new Error('Scraping timeout'));
        }, 12000);

        win.webContents.on('did-finish-load', async () => {
          try {
            // Brief wait so SPA/React product lists finish hydrating
            await new Promise((r) => setTimeout(r, 900));
            if (win.isDestroyed()) return;
            const finalUrl = win.webContents.getURL();
            const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
            const blocked = detectBlockedPage(html, finalUrl);
            finish(null, { html: blocked ? '' : html, blocked, finalUrl });
          } catch (e) {
            finish(e);
          }
        });

        win.webContents.on('did-fail-load', (_e, code, desc) => {
          // Ignore subresource/aborted errors
          if (code === -3) return;
          finish(new Error(`Load failed (${code}): ${desc}`));
        });

        win.webContents.setUserAgent(USER_AGENT);
        win.loadURL(url, {
          extraHeaders: 'Accept-Language: ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7\r\n',
        }).catch((e) => finish(e));
      });
    }

    /**
     * Opens a visible browser window bound to the same `persist:shopping` partition
     * so staff can sign in or complete verification directly on Naver Shopping / Coupang.
     */
    function openVisibleSessionWindow(channel) {
      const targetUrl =
        channel === 'coupang'
          ? 'https://www.coupang.com/'
          : 'https://search.shopping.naver.com/';
      const title =
        channel === 'coupang'
          ? '쿠팡 세션 연결 (로그인/확인 후 창을 닫아주세요)'
          : '네이버 쇼핑 세션 연결 (로그인/확인 후 창을 닫아주세요)';

      const authWin = new BrowserWindow({
        width: 1100,
        height: 800,
        title,
        autoHideMenuBar: true,
        webPreferences: {
          partition: SHOPPING_PARTITION,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      authWin.webContents.setUserAgent(USER_AGENT);
      authWin.loadURL(targetUrl);
    }

    // 1. 임의의 빈 포트(0)로 Next.js 서버를 내부에서 띄웁니다.
    const server = createServer(async (req, res) => {
      // Intercept internal scrape request
      if (req.url && req.url.startsWith('/api/internal/scrape?')) {
        const parsed = new URL(req.url, 'http://localhost');
        const targetUrl = parsed.searchParams.get('url');
        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing url' }));
        }
        try {
          const result = await scrapeWithPersistentSession(targetUrl);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message, blocked: false, html: '' }));
        }
      }

      // Open visible user session window for Naver / Coupang verification
      if (req.url && req.url.startsWith('/api/internal/open-session')) {
        const parsed = new URL(req.url, 'http://localhost');
        const channel = parsed.searchParams.get('channel') === 'coupang' ? 'coupang' : 'naver';
        try {
          openVisibleSessionWindow(channel);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, channel }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      handle(req, res);
    });

    server.listen(0, () => {
      const port = server.address().port;
      process.env.PORT = String(port);
      console.log(`> Next.js Server Ready on http://localhost:${port}`);

      // 2. 서버가 뜨면 일렉트론 브라우저 창을 생성합니다.
      mainWindow = new BrowserWindow({
        width: 1400,
        height: 860,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: true,
        },
      });

      // 3. 브라우저 창이 내부 Next.js 서버로 접속합니다.
      mainWindow.loadURL(`http://localhost:${port}`);

      const isInternalUrl = (url) => url.startsWith(`http://localhost:${port}`);

      // 외부 링크를 기본 시스템 브라우저(크롬, 엣지 등)로 열리도록 가로채기
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isInternalUrl(url)) {
          return { action: 'allow' };
        }
        if (url.startsWith('http://') || url.startsWith('https://')) {
          require('electron').shell.openExternal(url);
          return { action: 'deny' };
        }
        return { action: 'allow' };
      });

      mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!isInternalUrl(url) && (url.startsWith('http://') || url.startsWith('https://'))) {
          event.preventDefault();
          require('electron').shell.openExternal(url);
        }
      });

      mainWindow.on('closed', () => {
        mainWindow = null;
      });
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
