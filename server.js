/*
 * Node HTTP server for Dr. Albert insurance pre-check.
 *
 * This server serves static files from the /public directory
 * and handles POST requests to /submit (or /api/submit for
 * compatibility with older versions). It does not require
 * external OCR dependencies; instead it uses a simple heuristic
 * on the uploaded images to infer plan type. PPO and POS plans
 * are considered to have out-of-network benefits; HMO/EPO plans
 * are assumed not to.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Set your redirect URLs here
const BOOKING_URL = 'https://ai.henigan.io/picture';
const SELFPAY_URL = 'https://www.albertplasticsurgery.com/patient-resources/financing/';

// Send a JSON response
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Heuristic plan detection: use the total size of both images to infer plan type
function inferPlan(frontBuf, backBuf) {
  const total = (frontBuf?.length || 0) + (backBuf?.length || 0);
  const planType = total % 2 === 0 ? 'PPO' : 'HMO';
  const hasOON = planType === 'PPO';
  return { planType, hasOON };
}

const server = http.createServer(async (req, res) => {
  const url = req.url;

  // Handle static files under /public
  if (req.method === 'GET') {
    let filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
    if (!filePath.startsWith(path.join(__dirname, 'public'))) {
      // Prevent path traversal
      send(res, 400, { success: false, message: 'Bad request' });
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        // File not found
        if (url === '/' || url === '/index.html') {
          send(res, 404, { success: false, message: 'UI not found' });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
      // Serve file with basic MIME type detection
      const ext = path.extname(filePath).toLowerCase();
      const mimes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }

  // Handle POST submissions
  if (req.method === 'POST' && (url === '/submit' || url === '/api/submit')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { front, back } = JSON.parse(body);
        if (!front || !back) {
          send(res, 400, { success: false, message: 'Missing images' });
          return;
        }
        const frontBuf = Buffer.from(front, 'base64');
        const backBuf = Buffer.from(back, 'base64');
        const { planType, hasOON } = inferPlan(frontBuf, backBuf);
        if (!hasOON || planType === 'HMO') {
          send(res, 200, { success: false, message: `Unfortunately, your insurance is not eligible for coverage at Dr. Albert’s office. You can still book a self-pay consultation here: ${SELFPAY_URL}` });
          return;
        }
        send(res, 200, { success: true, message: 'You’re eligible to move forward.', link: BOOKING_URL, details: { planType, hasOON } });
      } catch (err) {
        send(res, 500, { success: false, message: 'Server error' });
      }
    });
    return;
  }

  // 404 for other routes
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
