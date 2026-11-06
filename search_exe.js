const fs = require('fs');
const path = require('path');
const os = require('os');
const exe = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe');
const buf = fs.readFileSync(exe);
const str = buf.toString('latin1');

['AuthLogout', 'GetLocalUserInfo', 'FetchUserInfo', 'jetski-standalone-oauth-token', 'gemini:antigravity'].forEach(kw => {
  let idx = 0;
  let count = 0;
  while ((idx = str.indexOf(kw, idx)) !== -1 && count < 2) {
    const s = str.substring(Math.max(0, idx - 100), Math.min(str.length, idx + 150));
    const printable = s.replace(/[^ -~]/g, '.');
    console.log('[' + kw + ' @ ' + idx + ']: ' + printable);
    idx += kw.length + 1;
    count++;
  }
});
