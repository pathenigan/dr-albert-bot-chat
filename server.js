/*
 * Node HTTP server for Dr. Albert insurance verification with plan selection.
 *
 * This version allows the front-end to send a selected planType directly
 * (e.g. PPO, POS, HMO, EPO, Medicare, Medicaid). If provided, we trust
 * the user’s selection and decide eligibility accordingly: only PPO and
 * POS plans are accepted. If planType is absent, the server falls back
 * to OCR detection using tesseract.js and the robust parsing from v3.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');

const BOOKING_URL = 'https://ai.henigan.io/picture';
const SELFPAY_URL = 'https://www.albertplasticsurgery.com/patient-resources/financing/';

// OCR worker setup
const worker = createWorker({ logger: m => console.log(m) });
let workerReady = false;
async function ensureWorker() {
  if (!workerReady) {
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    workerReady = true;
  }
}

// Normalize text and parse plan as in v3
function normalize(text) {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function parsePlan(text) {
  const up = text.toUpperCase();
  const collapsed = normalize(text);
  const hasPPO = /\bPPO\b/.test(up) || collapsed.includes('PPO') || collapsed.includes('PREFERREDPROVIDERORGANIZATION');
  const hasPOS = /\bPOS\b/.test(up) || collapsed.includes('POS') || collapsed.includes('POINTOFSERVICE');
  const hasHMO = /\bHMO\b/.test(up) || collapsed.includes('HMO') || collapsed.includes('HEALTHMAINTENANCEORGANIZATION');
  const hasEPO = /\bEPO\b/.test(up) || collapsed.includes('EPO') || collapsed.includes('EXCLUSIVEPROVIDERORGANIZATION');
  const hasMedicare = collapsed.includes('MEDICARE');
  const hasMedicaid = collapsed.includes('MEDICAID');
  const hasOther = collapsed.includes('TRICARE') || collapsed.includes('VETERANS') || collapsed.includes('VA') || collapsed.includes('CATASTROPHIC');
  if (hasMedicare || hasMedicaid || hasOther) {
    return { planType: 'NON-COMMERCIAL', hasOON: false, conflict: true };
  }
  const flags = [hasPPO, hasPOS, hasHMO, hasEPO];
  const count = flags.filter(Boolean).length;
  if (count !== 1) {
    return { planType: count === 0 ? 'UNKNOWN' : 'CONFLICT', hasOON: false, conflict: true };
  }
  let planType;
  let hasOON;
  if (hasPPO) { planType = 'PPO'; hasOON = true; }
  else if (hasPOS) { planType = 'POS'; hasOON = true; }
  else if (hasHMO) { planType = 'HMO'; hasOON = false; }
  else { planType = 'EPO'; hasOON = false; }
  return { planType, hasOON, conflict: false };
}
async function ocr(buffer) {
  await ensureWorker();
  const { data: { text } } = await worker.recognize(buffer);
  return text;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const { method, url } = req;
  // Serve static
  if (method === 'GET') {
    let filePath;
    if (url === '/' || url === '/index.html') filePath = path.join(__dirname, 'public', 'index.html');
    else if (url.startsWith('/public/')) filePath = path.join(__dirname, url);
    else filePath = path.join(__dirname, 'public', url);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(__dirname))) {
      sendJson(res, 400, { success: false, message: 'Bad request' });
      return;
    }
    fs.readFile(resolved, (err, data) => {
      if (err) {
        if (url === '/' || url === '/index.html') sendJson(res, 404, { success: false, message: 'UI not found' });
        else {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const mimes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  // Handle submission
  if (method === 'POST' && (url === '/submit' || url === '/api/submit')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { front, back, planType } = payload;
        if (!front || !back) {
          sendJson(res, 400, { success: false, message: 'Missing images' });
          return;
        }
        // If planType was provided by user, trust it
        if (planType) {
          const type = planType.toUpperCase();
          const eligible = type === 'PPO' || type === 'POS';
          if (!eligible) {
            sendJson(res, 200, { success: false, message: `Unfortunately, your insurance is not eligible for coverage at Dr. Albert’s office. You can still book a self-pay consultation here: ${SELFPAY_URL}`, details: { planType: type } });
            return;
          }
          sendJson(res, 200, { success: true, message: 'You’re eligible to move forward.', link: BOOKING_URL, details: { planType: type, hasOON: true } });
          return;
        }
        // Otherwise, run OCR
        const frontBuf = Buffer.from(front, 'base64');
        const backBuf  = Buffer.from(back,  'base64');
        const [frontText, backText] = await Promise.all([ocr(frontBuf), ocr(backBuf)]);
        const analysis = parsePlan(`${frontText}\n${backText}`);
        if (analysis.conflict || !analysis.hasOON) {
          sendJson(res, 200, { success: false, message: `Unfortunately, your insurance is not eligible for coverage at Dr. Albert’s office. You can still book a self-pay consultation here: ${SELFPAY_URL}`, details: analysis });
          return;
        }
        sendJson(res, 200, { success: true, message: 'You’re eligible to move forward.', link: BOOKING_URL, details: analysis });
      } catch (err) {
        console.error(err);
        sendJson(res, 500, { success: false, message: 'Server error' });
      }
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

module.exports = server;
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log('Server listening on', PORT));
}
