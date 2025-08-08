const $m = document.getElementById('messages');
const $front = document.getElementById('fileFront');
const $back = document.getElementById('fileBack');
const $attach = document.getElementById('attach');
const $send = document.getElementById('send');

function bubble(text, side='left', html=false) {
  const d = document.createElement('div');
  d.className = `msg ${side}`;
  d[html ? 'innerHTML' : 'textContent'] = text;
  $m.appendChild(d);
  $m.scrollTop = $m.scrollHeight;
  return d;
}

function typing(on=true) {
  if (on) {
    const n = bubble('typing…','left');
    n.classList.add('typing');
    return n;
  } else {
    const t = $m.querySelector('.typing');
    if (t) t.remove();
  }
}

function toB64(file) { return new Promise((res, rej)=>{
  const r = new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=rej; r.readAsDataURL(file);
});}

let frontB64 = null, backB64 = null;
bubble("Hi, I’m the intake assistant. I’ll check your insurance for out-of-network coverage so we know if you qualify to book with Dr. Albert.\n\nFirst, upload the FRONT of your insurance card, then the BACK.");

$attach.onclick = () => {
  if (!frontB64) $front.click(); else $back.click();
};

$front.onchange = async () => {
  if (!$front.files[0]) return;
  frontB64 = await toB64($front.files[0]);
  const url = URL.createObjectURL($front.files[0]);
  bubble(`<div>Got the front.</div><div class="preview"><img src="${url}"/></div>`,'right',true);
  if (!backB64) bubble("Now upload the BACK of the card.");
  if (frontB64 && backB64) $send.disabled = false;
};

$back.onchange = async () => {
  if (!$back.files[0]) return;
  backB64 = await toB64($back.files[0]);
  const url = URL.createObjectURL($back.files[0]);
  bubble(`<div>Got the back.</div><div class="preview"><img src="${url}"/></div>`,'right',true);
  if (frontB64 && backB64) $send.disabled = false;
};

$send.onclick = async () => {
  $send.disabled = true;
  const t = typing(true);
  try {
    const res = await fetch('/api/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({front: frontB64, back: backB64})});
    const data = await res.json();
    typing(false);
    if (data.success && data.link) {
      bubble("You’re eligible to move forward. Redirecting to the booking bot…");
      // Auto-redirect immediately
      window.location.href = data.link;
      return;
    } else {
      bubble(data.message || 'Not eligible.');
    }
  } catch (e) {
    typing(false);
    bubble('Server error. Try again.');
  }
  $send.disabled = false;
};