const express = require('express');
const path = require('path');
// We will call Google Vision API via REST rather than using the heavy
// @google-cloud/vision client library. Node 18+ includes fetch natively.

// Create an Express application
const app = express();

// Increase request body size limit to handle base64-encoded images (default is 100kb)
app.use(express.json({ limit: '15mb' }));

// Helper to normalize text by stripping non-alphanumeric characters and uppercase
function normalize(text) {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Plan detection logic. Returns an object with planType, hasOON (out-of-network
// availability) and conflict (true if the plan couldn’t be definitively
// identified). This is the same heuristic used throughout the project.
function parsePlan(rawText) {
  const up = rawText.toUpperCase();
  const collapsed = normalize(rawText);

  const hasPPO = /\bPPO\b/.test(up) || collapsed.includes('PPO') || collapsed.includes('PREFERREDPROVIDERORGANIZATION');
  const hasPOS = /\bPOS\b/.test(up) || collapsed.includes('POS') || collapsed.includes('POINTOFSERVICE');
  const hasHMO = /\bHMO\b/.test(up) || collapsed.includes('HMO') || collapsed.includes('HEALTHMAINTENANCEORGANIZATION');
  const hasEPO = /\bEPO\b/.test(up) || collapsed.includes('EPO') || collapsed.includes('EXCLUSIVEPROVIDERORGANIZATION');
  const hasMedicare = collapsed.includes('MEDICARE');
  const hasMedicaid = collapsed.includes('MEDICAID');
  const hasOther = collapsed.includes('TRICARE') || collapsed.includes('VETERANS') || collapsed.includes('VA') || collapsed.includes('CATASTROPHIC');

  // Reject non-commercial plans outright
  if (hasMedicare || hasMedicaid || hasOther) {
    return { planType: 'NON-COMMERCIAL', hasOON: false, conflict: true };
  }

  // Ensure only one plan type is detected
  const flags = [hasPPO, hasPOS, hasHMO, hasEPO];
  const count = flags.filter(Boolean).length;
  if (count !== 1) {
    return { planType: count === 0 ? 'UNKNOWN' : 'CONFLICT', hasOON: false, conflict: true };
  }

  let planType;
  let hasOON;
  if (hasPPO) {
    planType = 'PPO';
    hasOON = true;
  } else if (hasPOS) {
    planType = 'POS';
    hasOON = true;
  } else if (hasHMO) {
    planType = 'HMO';
    hasOON = false;
  } else {
    planType = 'EPO';
    hasOON = false;
  }
  return { planType, hasOON, conflict: false };
}

// URLs to redirect the user based on eligibility
const BOOKING_URL = 'https://ai.henigan.io/picture';
const SELFPAY_URL = 'https://www.albertplasticsurgery.com/patient-resources/financing/';

/*
 * OCR provider wrapper
 *
 * This function uses the OCR.space API to extract text from a base64‑encoded
 * image. OCR.space offers a generous free tier and doesn’t require
 * downloading language data or compiling native modules. To use it, sign up
 * at https://ocr.space/ocrapi and obtain an API key. Set that key in
 * your hosting platform as the environment variable `OCR_SPACE_API_KEY`.
 */
async function callOcrSpace(base64String) {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    throw new Error('OCR_SPACE_API_KEY environment variable is not set');
  }
  // OCR.space expects a data URI including the MIME type. We’ll prefix the
  // base64 image with a generic PNG header. JPEGs will also work.
  const dataUri = `data:image/png;base64,${base64String}`;
  // Construct a URL‑encoded form. OCR.space uses multipart or form‑encoded
  // requests. We choose form‑encoded here for simplicity.
  const params = new URLSearchParams();
  params.append('apikey', apiKey);
  params.append('base64Image', dataUri);
  params.append('language', 'eng');
  params.append('OCREngine', '1');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OCR.space error: ${response.status} ${text}`);
  }
  const data = await response.json();
  // Extract the parsed text. OCR.space nests results under ParsedResults.
  const results = data.ParsedResults || [];
  return results.length > 0 ? results[0].ParsedText || '' : '';
}

// OCR endpoint. Expects a JSON body with `front` and `back` base64 strings.
app.post('/ocr', async (req, res) => {
  try {
    const { front, back } = req.body;
    if (!front || !back) {
      return res.status(400).json({ success: false, message: 'Missing images' });
    }
    // Call the OCR provider on both images in parallel. We pass the base64 strings directly.
    const [frontText, backText] = await Promise.all([
      callOcrSpace(front),
      callOcrSpace(back)
    ]);
    // Determine plan eligibility
    const plan = parsePlan(`${frontText}\n${backText}`);
    if (plan.conflict || !plan.hasOON) {
      return res.json({
        success: false,
        message: 'Unfortunately, your insurance is not eligible for coverage at Dr. Albert’s office.',
        redirect: SELFPAY_URL,
        details: plan
      });
    } else {
      return res.json({
        success: true,
        message: 'You’re eligible to move forward.',
        redirect: BOOKING_URL,
        details: plan
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Serve static files from the `public` directory
app.use(express.static('public'));

// Start the HTTP server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Server started on port', port);
});
