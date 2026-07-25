const { app, BrowserWindow } = require('electron');
const { createServer } = require('http');
const next = require('next');
const path = require('path');

// Packaged 환경(exe)에서는 isPackaged가 true가 됩니다.
const dev = !app.isPackaged;

// Secure Environment Injection (Obfuscated)
if (!dev) {
  process.env.DATABASE_URL = Buffer.from('cG9zdGdyZXNxbDovL3Bvc3RncmVzLnNram9mb2x0b2t4d3d6aXVjcmhvOmdvemxkdGxmZ2VrMTJAYXdzLTEtYXAtc291dGgtMS5wb29sZXIuc3VwYWJhc2UuY29tOjY1NDMvcG9zdGdyZXM/cGdib3VuY2VyPXRydWU=', 'base64').toString('utf-8');
  process.env.DIRECT_URL = Buffer.from('cG9zdGdyZXNxbDovL3Bvc3RncmVzLnNram9mb2x0b2t4d3d6aXVjcmhvOmdvemxkdGxmZ2VrMTJAYXdzLTEtYXAtc291dGgtMS5wb29sZXIuc3VwYWJhc2UuY29tOjU0MzIvcG9zdGdyZXM=', 'base64').toString('utf-8');
  
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
    // 1. 임의의 빈 포트(0)로 Next.js 서버를 내부에서 띄웁니다.
    const server = createServer((req, res) => {
      handle(req, res);
    });
    
    server.listen(0, () => {
      const port = server.address().port;
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
