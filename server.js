const http = require('http');
const fs = require('fs');
const path = require('path');
const {execFile} = require('child_process');

const PORT = process.env.PORT || 3000;
const TMP_DIR = path.join(__dirname, 'tmp');

function send(res, code, body, headers={}) {
  const h = Object.assign({'Content-Type': 'application/json'}, headers);
  res.writeHead(code, h);
  res.end(JSON.stringify(body));
}

function toJSON(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { reject(e); }
    });
  });
}

function serveFile(res, p, type) {
  try {
    const data = fs.readFileSync(p);
    res.writeHead(200, {'Content-Type': type});
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

function routeStatic(req, res) {
  if (req.method === 'GET' && req.url === '/') {
    return serveFile(res, path.join(__dirname, 'public/index.html'), 'text/html');
  }
  if (req.method === 'GET' && req.url.startsWith('/public/')) {
    const filePath = path.join(__dirname, req.url);
    const type = req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.js') ? 'application/javascript' : 'application/octet-stream';
    return serveFile(res, filePath, type);
  }
  return false;
}

// Heuristic commercial/OON detection based on plan type keywords
function inferPlan(text) {
  const T = text.toUpperCase();
  const isGov = /(MEDICARE|MEDICAID|TRICARE|VA)/.test(T);
  if (isGov) return {planType: 'NON-COMMERCIAL', hasOON: false};
  let planType = 'UNKNOWN';
  if (/(PPO)\b/.test(T)) planType = 'PPO';
  else if (/\bPOS\b/.test(T)) planType = 'POS';
  else if (/\bEPO\b/.test(T)) planType = 'EPO';
  else if (/\bHMO\b/.test(T)) planType = 'HMO';
  const hasOON = (planType === 'PPO' || planType === 'POS');
  return {planType, hasOON};
}

// Run tesseract on an image file and return stdout text
function ocrImage(imgPath) {
  return new Promise((resolve) => {
    execFile('tesseract', [imgPath, 'stdout', '--psm', '6'], {timeout: 20000}, (err, stdout, stderr) => {
      if (err) {
        console.error('OCR error:', err);
        resolve(''); // fallback
      } else {
        resolve(stdout || '');
      }
    });
  });
}

function b64ToFile(b64, outPath) {
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(outPath, buf);
}

const server = http.createServer(async (req, res) => {
  if (routeStatic(req, res) !== false) return;

  if (req.method === 'POST' && req.url === '/api/submit') {
    try {
      const body = await toJSON(req);
      if (!body.front || !body.back) return send(res, 400, {success: false, message: 'Need front and back images.'});
      if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, {recursive: true});

      const frontPath = path.join(TMP_DIR, `front-${Date.now()}.jpg`);
      const backPath  = path.join(TMP_DIR, `back-${Date.now()}.jpg`);
      b64ToFile(body.front, frontPath);
      b64ToFile(body.back, backPath);

      const [frontText, backText] = await Promise.all([ocrImage(frontPath), ocrImage(backPath)]);
      const allText = `${frontText}\n${backText}`;
      const {planType, hasOON} = inferPlan(allText);

      const insurer = (allText.match(/([A-Z][A-Z]+(?:\s[A-Z][A-Z]+)*)\s+(INSURANCE|HEALTH|BLUE|CROSS|SHIELD)/) || [])[0] || '';
      const memberId = (allText.match(/\bID[:\s]*([A-Z0-9\-]+)/i) || [])[1] || '';
      const groupNumber = (allText.match(/\bGROUP[:\s]*([A-Z0-9\-]+)/i) || [])[1] || '';
      const planName = (allText.match(/\b(PPO|POS|EPO|HMO)[^\n]{0,20}/i) || [])[0] || '';

      fs.rm(frontPath, {force:true}, ()=>{});
      fs.rm(backPath, {force:true}, ()=>{});

      if (planType === 'NON-COMMERCIAL') return send(res, 200, {success:false, message:'Non-commercial plan detected (e.g., Medicare/Medicaid).'});
      if (!hasOON) return send(res, 200, {success:false, message:'Your plan does not show out-of-network benefits.'});

      return send(res, 200, {
        success: true,
        message: 'You’re eligible to move forward.',
        link: 'https://calendly.com/albertplasticsurgery/econsult',
        details: {planType, hasOON, insurer, memberId, groupNumber, planName}
      });
    } catch (e) {
      console.error(e);
      return send(res, 500, {success:false, message:'Server error.'});
    }
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
