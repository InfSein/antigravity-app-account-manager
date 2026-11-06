const http = require('http');
const fs = require('fs');
const { DEVTOOLS_PORT_FILE } = require('./src/constants');
const port = parseInt(fs.readFileSync(DEVTOOLS_PORT_FILE, 'utf8').trim().split('\n')[0], 10);

http.get('http://127.0.0.1:' + port + '/json/list', (res) => {
  let raw = '';
  res.on('data', chunk => raw += chunk);
  res.on('end', () => {
    const targets = JSON.parse(raw);
    const mainPage = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
    const ws = new WebSocket(mainPage.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(async () => {
            const token = window.__anyCapturedHeaders ? window.__anyCapturedHeaders.headers['x-codeium-csrf-token'] : '';
            const res = await fetch('/exa.language_server_pb.LanguageServerService/GetUserStatus', {
              method: 'POST',
              headers: {
                'content-type': 'application/grpc-web+json',
                'x-codeium-csrf-token': token,
                'x-grpc-web': '1'
              },
              body: '{}'
            });
            return {
              status: res.status,
              body: await res.text()
            };
          })()`,
          awaitPromise: true,
          returnByValue: true
        }
      }));
    };
    ws.onmessage = (e) => {
      console.log('GetUserStatus Response:', e.data);
      ws.close();
      process.exit(0);
    };
  });
});
