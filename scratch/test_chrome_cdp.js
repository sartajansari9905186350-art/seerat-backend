const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

async function testBrowser() {
  // 1. Create a local HTTP server simulating the Admin web origin
  const htmlContent = fs.readFileSync('C:\\Users\\sarta\\.gemini\\antigravity-ide\\scratch\\IslamicApp\\backend\\scratch\\test_browser_video.html', 'utf8');
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(htmlContent);
  });
  await new Promise(r => server.listen(8899, '127.0.0.1', r));
  console.log('Local test web server running on http://127.0.0.1:8899');

  // 2. Launch Google Chrome
  console.log('Launching Google Chrome with CDP and autoplay permissions...');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 1200));

  const tabs = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 9222,
      path: '/json/new',
      method: 'PUT'
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });

  const wsUrl = tabs.webSocketDebuggerUrl;
  console.log('Chrome Debugger WebSocket URL:', wsUrl);

  const ws = new globalThis.WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let id = 1;
  const pendingRequests = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pendingRequests.has(msg.id)) {
      const resolver = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      resolver(msg.result);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
      console.log('   [Chrome Console]', text);
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const msgId = id++;
      pendingRequests.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  console.log('\nNavigating Chrome to http://127.0.0.1:8899...');
  await send('Page.navigate', { url: 'http://127.0.0.1:8899/' });

  // Wait 6 seconds for video buffering and playback
  await new Promise(r => setTimeout(r, 6000));

  // Explicitly call v.play() and check state
  const playCall = await send('Runtime.evaluate', {
    expression: `document.getElementById('v').play().then(() => 'PLAY_STARTED').catch(e => 'PLAY_ERROR: ' + e.message);`,
    awaitPromise: true
  });
  console.log('   v.play() call result:', playCall.result.value);

  await new Promise(r => setTimeout(r, 3000));

  // Evaluate video state in browser
  const evalResult = await send('Runtime.evaluate', {
    expression: `({
      readyState: document.getElementById('v').readyState,
      networkState: document.getElementById('v').networkState,
      duration: document.getElementById('v').duration,
      currentTime: document.getElementById('v').currentTime,
      paused: document.getElementById('v').paused,
      videoWidth: document.getElementById('v').videoWidth,
      videoHeight: document.getElementById('v').videoHeight,
      error: document.getElementById('v').error ? { code: document.getElementById('v').error.code, message: document.getElementById('v').error.message } : null
    })`,
    returnByValue: true
  });

  console.log('\n=== REAL CHROME HTML5 VIDEO PLAYBACK RESULT ===');
  console.log(JSON.stringify(evalResult.result.value, null, 2));

  ws.close();
  chrome.kill();
  server.close();
  process.exit(0);
}

testBrowser().catch(err => {
  console.error('Browser Test Error:', err);
  process.exit(1);
});
