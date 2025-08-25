const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BOOKING_URL = process.env.BOOKING_URL || 'https://ai.henigan.io/picture';
const SELFPAY_URL = process.env.SELFPAY_URL || 'https://www.albertplasticsurgery.com/patient-resources/financing/';

// Parse JSON body
function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
    });
  });
}

// Run Tesseract
function runTesseract(imagePath) {
  return new Promise((resolve, reject) => {
    execFile('tesseract', [imagePath, 'stdout', '--psm', '6'], (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
  });
}

// Extract insurance info
async function extractInsuranceInfo(frontBuffer, backBuffer, frontPath, backPath) {
  let text = '';
  try {
    const [frontText, backText] = await Promise.all([
      runTesseract(frontPath),
      runTesseract(backPath),
    ]);
    text = `${frontText}\n${backText}`;
  } catch (err) {
    console.error('OCR error:', err);
    text = '';
  }
  const lower = text.toLowerCase();
  let planType = 'UNKNOWN';
  if (lower.includes('ppo')) planType = 'PPO';
  else if (lower.includes('pos')) planType = 'POS';
  else if (lower.includes('epo')) planType = 'EPO';
  else if (lower.includes('hmo')) planType = 'HMO';
  const hasOON = planType === 'PPO' || planType === 'POS';
  const idMatch = text.match(/\b(\d{8,})\b/);
  const memberId = idMatch ? idMatch[1] : '';
  const groupMatch = text.match(/group\s*#?:?\s*(\d+)/i);
  const groupNumber = groupMatch ? groupMatch[1] : '';
  let insurer = '';
  const insurers = ['aetna','humana','cigna','united','blue cross','anthem','etna'];
  for (const name of insurers) {
    if (lower.includes(name)) {
      insurer = name.replace(/\b\w/g, c => c.toUpperCase());
      break;
    }
  }
  const planName = planType !== 'UNKNOWN' ? `${planType} Plan` : '';
  return { planType, hasOON, insurer, memberId, groupNumber, planName };
}

// Determine commercial plan
function isCommercialPlan(planName) {
  const nonCom = ['medicare','medicaid','tricare','va','catastrophic'];
  const lower = planName.toLowerCase();
  return !nonCom.some(k => lower.includes(k));
}

// Serve static files with no-store caching
function serveFile(filePath, res) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html',
      '.css':  'text/css',
      '.js':   'application/javascript',
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif':  'image/gif',
      '.svg':  'image/svg+xml',
    };
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

// Create temporary directory
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  if (method === 'GET') {
    const filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
    serveFile(filePath, res);
    return;
  }
  if (method === 'POST' && (url === '/submit' || url === '/api/submit')) {
    try {
      const body = await parseJSONBody(req);
      const { front, back } = body;
      if (!front || !back) throw new Error('Missing front or back image.');
      const frontBuffer = Buffer.from(front, 'base64');
      const backBuffer  = Buffer.from(back,  'base64');
      const timestamp = Date.now();
      const frontPath = path.join(tmpDir, `front-${timestamp}.jpg`);
      const backPath  = path.join(tmpDir, `back-${timestamp}.jpg`);
      fs.writeFileSync(frontPath, frontBuffer);
      fs.writeFileSync(backPath,  backBuffer);
      const info = await extractInsuranceInfo(frontBuffer, backBuffer, frontPath, backPath);
      const commercial = isCommercialPlan(info.planName);
      const eligible   = commercial && info.hasOON;
      if (eligible) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'You’re eligible to move forward.', link: BOOKING_URL, details: info }));
      } else {
        const message = !commercial ? 'Your plan is not a commercial insurance (e.g. Medicare/Medicaid).' : 'Your plan does not show out‑of‑network benefits.';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message, details: info }));
      }
    } catch (err) {
      console.error(err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Invalid request.' }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

module.exports = server;
  const groupNumber = groupMatch ? groupMatch[1] : '';
  let insurer = '';
  const insurers = ['aetna','humana','cigna','united','blue cross','anthem','etna'];
  for (const name of insurers) {
    if (lower.includes(name)) {
      insurer = name.replace(/\b\w/g, c => c.toUpperCase());
      break;
    }
  }
  const planName = planType !== 'UNKNOWN' ? `${planType} Plan` : '';
  return {planType, hasOON, insurer, memberId, groupNumber, planName};
}

// Determine commercial plan
function isCommercialPlan(planName) {
  const nonCom = ['medicare','medicaid','tricare','va','catastrophic'];
  const lower = planName.toLowerCase();
  return !nonCom.some(k => lower.includes(k));
}

// Serve static files with no-store caching
function serveFile(filePath, res) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
    };
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {'Content-Type': mime[ext] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

// Create tmp dir
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  if (method === 'GET') {
    const filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
    serveFile(filePath, res);
    return;
  }
  if (method === 'POST' && (url === '/submit' || url === '/api/submit')) {
    try {
      const body = await parseJSONBody(req);
      const { front, back } = body;
      if (!front || !back) throw new Error('Missing front or back image.');
      const frontBuffer = Buffer.from(front, 'base64');
      const backBuffer  = Buffer.from(back, 'base64');
      const timestamp = Date.now();
      const frontPath = path.join(tmpDir, `front-${timestamp}.jpg`);
      const backPath  = path.join(tmpDir, `back-${timestamp}.jpg`);
      fs.writeFileSync(frontPath, frontBuffer);
      fs.writeFileSync(backPath, backBuffer);
      const info = await extractInsuranceInfo(frontBuffer, backBuffer, frontPath, backPath);
      const commercial = isCommercialPlan(info.planName);
      const eligible   = commercial && info.hasOON;
      if (eligible) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({success:true,message:'You’re eligible to move forward.',link:BOOKING_URL,details:info}));
      } else {
        const message = !commercial ? 'Your plan is not a commercial insurance (e.g. Medicare/Medicaid).' : 'Your plan does not show out‑of‑network benefits.';
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({success:false,message: message,details:info}));
      }
    } catch (err) {
      console.error(err);
      res.writeHead(400, {'Content-Type':'application/json'});
      res.end(JSON.stringify({success:false,message:'Invalid request.'}));
    }
    return;
  }
  res.writeHead(404, {'Content-Type':'application/json'});
  res.end(JSON.stringify({error:'Not found'}));
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

module.exports = server;
