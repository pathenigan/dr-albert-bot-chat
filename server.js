/*
 * Node HTTP server for Dr. Albert insurance verification with improved OCR logic.
 *
 * This version enhances the plan parsing heuristics to reduce false positives. It
 * inspects the OCR text for multiple plan keywords (PPO, POS, HMO, EPO) and
 * Medicare/Medicaid indicators. Conflicting plan types or presence of
 * non-commercial keywords cause the request to be rejected. Unknown or
 * ambiguous plans are also rejected.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');

const BOOKING_URL = 'https://ai.henigan.io/picture';
const SELFPAY_URL = 'https://www.albertplasticsurgery.com/patient-resources/financing/';

// Initialize OCR worker
const worker = createWorker({ logger: m => console.log(m) });
let ready = false;
async function ensureWorker() {
  if (!ready) {
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    ready = true;
  }
}

// Helper to send JSON
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Improved plan parser: detects multiple plan keywords and conflicts
function parsePlan(text) {
  const up = text.toUpperCase();
  const hasPPO = /\bPPO\b/.test(up);
  const hasPOS = /\bPOS\b/.test(up);
  const hasHMO = /\bHMO\b/.test(up);
  const hasEPO = /\bEPO\b/.test(up);
  const hasMedicare = /MEDICARE/.test(up);
  const hasMedicaid = /MEDICAID/.test(up);
  const hasOtherNonCom = /(TRICARE|VA|CATASTROPHIC)/.test(up);
  // If any non-commercial indicator present
  if (hasMedicare || hasMedicaid || hasOtherNonCom) {
    return { planType: 'NON-COMMERCIAL', hasOON: false, conflict: true };
  }
  // Count how many plan types appear
  const matches = [hasPPO, hasPOS, hasHMO, hasEPO].filter(Boolean).length;
  // If multiple plan keywords present, treat as conflict
  if (matches > 1) {
    return { planType: 'CONFLICT', hasOON: false, conflict: true };
  }
  let planType = 'UNKNOWN';
  let hasOON = false;
  if (hasPPO) {
    planType = 'PPO';
    hasOON = true;
  } else if (hasPOS) {
    planType = 'POS';
    hasOON = true;
  } else if (hasHMO) {
    planType = 'HMO';
    hasOON = false;
  } else if (hasEPO) {
    planType = 'EPO';
    hasOON = false;
  }
  return { planType, hasOON, conflict: false };
}

// OCR helper
async function recognize(buffer) {
  await ensureWorker();
  const { data: { text } } = await worker.recognize(buffer);
  return text;
}

const server = http.createServer((req, res) => {
  const { method, url } = req;
  if (method === 'GET') {
    let filePath;
    if (url === '/' || url === '/index.html') {
      filePath = path.join(__dirname, 'public', 'index.html');
    } else if (url.startsWith('/public/')) {
      filePath = path.join(__dirname, url);
    } else {
      filePath = path.join(__dirname, 'public', url);
    }
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(__dirname))) {
      sendJson(res, 400, { success: false, message: 'Bad request' });
      return;
    }
    fs.readFile(resolved, (err, data) => {
      if (err) {
        if (url === '/' || url === '/index.html') {
          sendJson(res, 404, { success: false, message: 'UI not found' });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const mimes = {
        '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
      };
      res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  if (method === 'POST' && (url === '/submit' || url === '/api/submit')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { front, back } = JSON.parse(body);
        if (!front || !back) {
          sendJson(res, 400, { success: false, message: 'Missing images' });
          return;
        }
        const frontBuf = Buffer.from(front, 'base64');
        const backBuf = Buffer.from(back, 'base64');
        const [frontText, backText] = await Promise.all([
          recognize(frontBuf),
          recognize(backBuf)
        ]);
        const analysis = parsePlan(`${frontText}\n${backText}`);
        const { planType, hasOON, conflict } = analysis;
        if (conflict || !hasOON || planType === 'UNKNOWN') {
          sendJson(res, 200, {
            success: false,
            message: `Unfortunately, your insurance is not eligible for coverage at Dr. Albert’s office. You can still book a self-pay consultation here: ${SELFPAY_URL}`,
            details: analysis
          });
          return;
        }
        sendJson(res, 200, {
          success: true,
          message: 'You’re eligible to move forward.',
          link: BOOKING_URL,
          details: analysis
        });
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
  server.listen(PORT, () => {
    console.log('Server listening on port', PORT);
  });
}
