// Chatbot client script
const messagesDiv = document.getElementById('messages');
const frontInput = document.getElementById('front');
const backInput = document.getElementById('back');
const attachBtn = document.getElementById('attach');
const sendBtn = document.getElementById('send');

function bubble(text, side = 'left', html = false) {
  const d = document.createElement('div');
  d.className = 'msg ' + side;
  if (html) {
    d.innerHTML = text;
  } else {
    d.textContent = text;
  }
  messagesDiv.appendChild(d);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return d;
}

async function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let frontB64 = null;
let backB64 = null;

// Initial instruction
bubble("Hi, I'm the intake assistant. Upload the FRONT of your insurance card, then the BACK.");

attachBtn.onclick = () => {
  if (!frontB64) {
    frontInput.click();
  } else {
    backInput.click();
  }
};

frontInput.onchange = async () => {
  if (!frontInput.files[0]) return;
  frontB64 = await toBase64(frontInput.files[0]);
  bubble('Got the front.', 'right');
  if (!backB64) bubble('Now upload the BACK of the card.');
  if (frontB64 && backB64) sendBtn.disabled = false;
};

backInput.onchange = async () => {
  if (!backInput.files[0]) return;
  backB64 = await toBase64(backInput.files[0]);
  bubble('Got the back.', 'right');
  if (frontB64 && backB64) sendBtn.disabled = false;
};

sendBtn.onclick = async () => {
  sendBtn.disabled = true;
  bubble('Checking…');
  try {
    const res = await fetch('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ front: frontB64, back: backB64 }),
    });
    const data = await res.json();
    if (data.success && data.link) {
      // Pass case: inform and redirect to booking bot
      bubble("You’re eligible to move forward.");
      setTimeout(() => {
        window.location.href = data.link;
      }, 1500);
    } else {
      // Fail case: show message, then redirect to self-pay after delay
      bubble("Unfortunately, your insurance is not eligible for coverage at Dr. Albert’s office. We're going to redirect you to our self pay option.");
      setTimeout(() => {
        window.location.href = 'https://www.albertplasticsurgery.com/patient-resources/financing/';
      }, 5500);
    }
  } catch (err) {
    console.error(err);
    bubble('Server error. Please try again later.');
  }
  sendBtn.disabled = false;
};
