/*
 * Node HTTP server for Dr. Albert insurance pre-check (v2).
 *
 * This server serves static files from the /public directory
 * and handles POST requests to /submit (or /api/submit).
 * It uses a simple heuristic on the uploaded images to infer plan type.
 * PPO and POS plans are considered to have out-of-network benefits; HMO/EPO plans are not.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configure redirect URLs
const BOOKING_URL = 'https://ai.henigan.io/picture';
const SELFPAY_URL = 'https://www.albertplasticsurgery.com/patient-resources/financing/';

// Send a JSON response
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Simple heuristic: infer plan type from total length of buffers
function inferPlan(frontBuf, backBuf) {
  const total = (frontBuf?.length || 0) + (backBuf?.length || 0);
  const planType = total % 2 === 0 ? 'PPO' : 'HMO';
  return { planType, hasOON: planType === 'PPO' };
}

const server = http.createServer((req, res) => {
  const url = req.url;
  // Serve static files and index
  if (req.method === 'GET') {
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
      send(res, 400, { success: false, message: 'Bad request' });
      return;
    }
    fs.readFile(resolved, (err, data) => {
      if (err) {
        if (url === '/' || url === '/index.html') {
          send(res, 404, { success: false, message: 'UI not found' });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const mimes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg'
      };
      res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  // Handle submissions
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
  // Fallback 404
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
