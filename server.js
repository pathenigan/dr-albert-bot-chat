/*
 * Node HTTP server for Dr. Albert insurance verification with OCR.
 *
 * This implementation uses the open‑source tesseract.js library to
 * perform optical character recognition (OCR) on uploaded insurance
 * card images. It extracts plan identifiers (e.g. PPO, HMO) and
 * determines eligibility based on whether the plan is commercial and
 * offers out‑of‑network benefits.
 *
 * Dependencies (add to your package.json and install via npm):
 *   "tesseract.js": "^4.0.2",
 *   "@tensorflow/tfjs-node": "^4.10.0" (optional but speeds up OCR)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');

// Configure redirect URLs
const BOOKING_URL = 'https://ai.henigan.io/picture';
const SELFPAY_URL = 'https://www.albertplasticsurgery.com/patient-resources/financing/';

// Initialize a single tesseract worker. Loading the worker once
// improves performance by caching language data across requests.
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

// Send a JSON response
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Parse OCR text to determine plan information.
function parsePlan(text) {
  const upper = text.toUpperCase();
  // Check for non‑commercial indicators
  const nonCommercial = /(MEDICARE|MEDICAID|TRICARE|VA|CATASTROPHIC)/.test(upper);
  // Identify plan type by keywords
  let planType = 'UNKNOWN';
  if (/\bPPO\b/.test(upper)) planType = 'PPO';
  else if (/\bPOS\b/.test(upper)) planType = 'POS';
  else if (/\bEPO\b/.test(upper)) planType = 'EPO';
  else if (/\bHMO\b/.test(upper)) planType = 'HMO';
  // Determine out‑of‑network benefits: PPO and POS typically allow OON
  const hasOON = planType === 'PPO' || planType === 'POS';
  return { planType, hasOON, nonCommercial };
}

// Perform OCR on a Buffer containing an image. Returns recognised text.
async function recognizeText(buffer) {
  await ensureWorker();
  const { data: { text } } = await worker.recognize(buffer);
  return text;
}

// HTTP server
const server = http.createServer((req, res) => {
  const { method, url } = req;
  // Serve static assets
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
  // Handle submissions
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
        // Run OCR on both sides
        const [frontText, backText] = await Promise.all([
          recognizeText(frontBuf),
          recognizeText(backBuf)
        ]);
        const allText = `${frontText}\n${backText}`;
        const { planType, hasOON, nonCommercial } = parsePlan(allText);
        if (nonCommercial || !hasOON) {
          sendJson(res, 200, {
            success: false,
            message: `Unfortunately, your insurance is not eligible for coverage at Dr. Albert’s office. You can still book a self-pay consultation here: ${SELFPAY_URL}`,
            details: { planType, hasOON, nonCommercial }
          });
          return;
        }
        sendJson(res, 200, {
          success: true,
          message: 'You’re eligible to move forward.',
          link: BOOKING_URL,
          details: { planType, hasOON, nonCommercial }
        });
      } catch (err) {
        console.error(err);
        sendJson(res, 500, { success: false, message: 'Server error' });
      }
    });
    return;
  }
  // Fallback
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
