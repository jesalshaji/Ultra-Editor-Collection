/* Ultra Premiere bridge: a small local HTTP server inside Premiere (CEP + Node).
 * The MCP server POSTs {cmd, args} to http://127.0.0.1:PORT/run with the shared token,
 * this file hands it to ExtendScript (jsx/premiere.jsx) and sends back the JSON result.
 * Only listens on 127.0.0.1 and refuses any request without the token. */
/* global window */
(function () {
  var http = require('http');
  var fs = require('fs');
  var path = require('path');
  var os = require('os');
  var crypto = require('crypto');

  // The same extension runs in Premiere (PPRO) and After Effects (AEFT): each host gets its own
  // port, ExtendScript file and log, and both share the token.
  var HOST = 'PPRO';
  try { HOST = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appName || 'PPRO'; } catch (e) {}
  var HOSTS = {
    PPRO: { port: 47231, jsx: 'premiere.jsx', global: 'PMCP', log: 'bridge.log', label: 'Ultra Premiere', app: 'Premiere' },
    AEFT: { port: 47232, jsx: 'aftereffects.jsx', global: 'AEMCP', log: 'bridge-ae.log', label: 'Ultra AE Link', app: 'After Effects' }
  };
  var CFG = HOSTS[HOST] || HOSTS.PPRO;
  var PORT = CFG.port;
  var VERSION = '1.1.0';
  var HOME = path.join(os.homedir(), '.ultra-premiere-mcp');
  var TOKEN_FILE = path.join(HOME, 'token');
  var LOG_FILE = path.join(HOME, CFG.log);

  function ensureHome() { try { fs.mkdirSync(HOME, { recursive: true }); } catch (e) {} }

  function log(msg) {
    var line = new Date().toISOString() + '  ' + msg + '\n';
    try {
      ensureHome();
      var st = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null;
      if (st && st.size > 512 * 1024) fs.writeFileSync(LOG_FILE, '');
      fs.appendFileSync(LOG_FILE, line);
    } catch (e) {}
    if (window.onBridgeLog) window.onBridgeLog(line);
  }

  function getToken() {
    ensureHome();
    try {
      var t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (t.length >= 32) return t;
    } catch (e) {}
    var tok = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(TOKEN_FILE, tok);
    return tok;
  }

  function extensionDir() {
    var p = window.__adobe_cep__.getSystemPath('extension');
    p = decodeURIComponent(String(p).replace(/^file:\/{2,3}/, ''));
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p;
  }

  function jsString(s) {
    return JSON.stringify(String(s)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function evalScript(code) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(code, function (res) { resolve(res); });
    });
  }

  var jsxPath = path.join(extensionDir(), 'jsx', CFG.jsx).replace(/\\/g, '/');
  var G = CFG.global;

  function loadJsx(force) {
    var code = force
      ? '$.evalFile(' + jsString(jsxPath) + '); typeof ' + G + ';'
      : '(typeof ' + G + ' === "undefined") ? ($.evalFile(' + jsString(jsxPath) + '), typeof ' + G + ') : typeof ' + G + ';';
    return evalScript(code);
  }

  // one command at a time: ExtendScript is single-threaded anyway
  var chain = Promise.resolve();
  function runCommand(cmd, args, timeoutMs) {
    var job = chain.then(function () {
      return loadJsx(cmd === '__reload').then(function (state) {
        if (state !== 'object') {
          return JSON.stringify({ ok: false, error: 'Could not load ' + CFG.jsx + ' (got: ' + state + ')' });
        }
        if (cmd === '__reload') return JSON.stringify({ ok: true, result: 'reloaded' });
        var call = G + '.run(' + jsString(cmd) + ',' + jsString(JSON.stringify(args || {})) + ')';
        var timer;
        var timeout = new Promise(function (resolve) {
          timer = setTimeout(function () {
            resolve(JSON.stringify({ ok: false, error: 'Timed out after ' + timeoutMs + ' ms (' + CFG.app + ' may still be working)' }));
          }, timeoutMs);
        });
        return Promise.race([evalScript(call), timeout]).then(function (r) { clearTimeout(timer); return r; });
      });
    });
    chain = job.catch(function () {});
    return job;
  }

  function send(res, code, obj) {
    var body = typeof obj === 'string' ? obj : JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  }

  function start(onState) {
    var token = getToken();
    var server = http.createServer(function (req, res) {
      if (req.method === 'GET' && req.url === '/health') {
        return send(res, 200, { ok: true, bridge: HOST === 'AEFT' ? 'ultra-ae' : 'ultra-premiere', host: HOST, version: VERSION });
      }
      if (req.method !== 'POST' || req.url !== '/run') return send(res, 404, { ok: false, error: 'not found' });
      if (req.headers['x-bridge-token'] !== token) return send(res, 401, { ok: false, error: 'bad token' });
      var chunks = [];
      req.on('data', function (c) { chunks.push(c); });
      req.on('end', function () {
        var msg;
        try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {
          return send(res, 400, { ok: false, error: 'bad JSON' });
        }
        var t0 = Date.now();
        log('> ' + msg.cmd);
        runCommand(msg.cmd, msg.args, msg.timeoutMs || 120000).then(function (out) {
          if (out === 'EvalScript error.' || out === undefined || out === null || out === '') {
            out = JSON.stringify({ ok: false, error: 'ExtendScript error (' + out + ')' });
          }
          var ok = /^\s*\{\s*"ok"\s*:\s*true/.test(out);
          log((ok ? '  ok ' : '  FAIL ') + msg.cmd + ' ' + (Date.now() - t0) + 'ms' + (ok ? '' : '  ' + String(out).slice(0, 300)));
          send(res, 200, out);
        });
      });
    });
    server.on('error', function (e) {
      if (e.code === 'EADDRINUSE') { onState && onState('elsewhere'); }
      else { log('server error: ' + e.message); onState && onState('error', e.message); }
    });
    server.listen(PORT, '127.0.0.1', function () {
      log(CFG.label + ' bridge ' + VERSION + ' listening on 127.0.0.1:' + PORT);
      loadJsx(true).then(function (s) { log(CFG.jsx + ' loaded: ' + s); });
      onState && onState('listening');
    });
    return server;
  }

  function health() {
    return new Promise(function (resolve) {
      var req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 1500 }, function (res) {
        var d = ''; res.on('data', function (c) { d += c; }); res.on('end', function () { resolve(res.statusCode === 200); });
      });
      req.on('error', function () { resolve(false); });
      req.on('timeout', function () { req.destroy(); resolve(false); });
    });
  }

  window.ClaudeBridge = { start: start, health: health, log: log, LOG_FILE: LOG_FILE, PORT: PORT, runCommand: runCommand, HOST: HOST, CFG: CFG };
})();
