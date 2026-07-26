const { app, BrowserWindow } = require('electron');
const { createServer } = require('http');
const next = require('next');
const path = require('path');

// Packaged 환경(exe)에서는 isPackaged가 true가 됩니다.
const dev = !app.isPackaged;

const crypto = require('crypto');

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

// next() 디렉토리 설정. 
// 패키징되었을 때는 __dirname 기반으로 설정해야 올바른 위치를 찾습니다.
const nextApp = next({ dev, dir: __dirname });
const handle = nextApp.getRequestHandler();

let mainWindow;

app.whenReady().then(() => {
  nextApp.prepare().then(() => {
    
    // 백그라운드 크롤링용 보이지 않는 브라우저 함수
    async function scrapeWithInvisibleBrowser(url) {
      return new Promise((resolve, reject) => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });

        const timeout = setTimeout(() => {
          if (!win.isDestroyed()) win.destroy();
          reject(new Error('Scraping timeout'));
        }, 15000);

        win.webContents.on('did-finish-load', async () => {
          clearTimeout(timeout);
          try {
            const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
            if (!win.isDestroyed()) win.destroy();
            resolve(html);
          } catch(e) {
            if (!win.isDestroyed()) win.destroy();
            reject(e);
          }
        });

        win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        win.loadURL(url).catch(e => {
          clearTimeout(timeout);
          if (!win.isDestroyed()) win.destroy();
          reject(e);
        });
      });
    }

    // 1. 임의의 빈 포트(0)로 Next.js 서버를 내부에서 띄웁니다.
    const server = createServer(async (req, res) => {
      // Intercept internal scrape request
      if (req.url && req.url.startsWith('/api/internal/scrape?url=')) {
        const targetUrl = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!targetUrl) {
          res.writeHead(400);
          return res.end('Missing url');
        }
        try {
          const html = await scrapeWithInvisibleBrowser(targetUrl);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ html }));
        } catch (e) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: e.message }));
        }
      }
      handle(req, res);
    });
    
    server.listen(0, () => {
      const port = server.address().port;
      process.env.PORT = port; // Let Next.js API routes know the port
      console.log(`> Next.js Server Ready on http://localhost:${port}`);
      
      // 2. 서버가 뜨면 일렉트론 브라우저 창을 생성합니다.
      mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: true,
        },
      });
      
      // 3. 브라우저 창이 내부 Next.js 서버로 접속합니다.
      mainWindow.loadURL(`http://localhost:${port}`);
      
      // 외부 링크를 기본 시스템 브라우저(크롬, 엣지 등)로 열리도록 가로채기 (Coupang/Naver 접속 제한 우회)
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          require('electron').shell.openExternal(url);
          return { action: 'deny' };
        }
        return { action: 'allow' };
      });

      mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url !== `http://localhost:${port}` && (url.startsWith('http://') || url.startsWith('https://'))) {
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
