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
  
  process.env.DATABASE_URL = __d('98b86b149172206a84d6de63dc6d143df1eb8eb9283976aca0d4a371ff70aaa1961679aa750add3949d0bca20cccb0644162bf97628acc08a7c03d977aad64398e9ae07d4c280aaabc29e8b4810931a15a5795ff569a15c79aa70c47ff21852d44ec211037b2ff4863c3a7bf7d1e1410829d8d7ba8d95db388aed675ba166243', _k, _v);
  process.env.DIRECT_URL = __d('98b86b149172206a84d6de63dc6d143df1eb8eb9283976aca0d4a371ff70aaa1961679aa750add3949d0bca20cccb0644162bf97628acc08a7c03d977aad64398e9ae07d4c280aaabc29e8b4810931a1f0f16e16c78ad8fd86d4ac91b2fbdf9551ed75488449a373bdbc0d8ca65b170c', _k, _v);
  
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
