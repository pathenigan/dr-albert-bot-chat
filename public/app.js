// Chatbot client script with plan selection
(function() {
  const messages = document.getElementById('messages');
  const frontInput = document.getElementById('front');
  const backInput  = document.getElementById('back');
  const attachBtn  = document.getElementById('attach');
  const sendBtn    = document.getElementById('send');
  let frontB64 = null;
  let backB64  = null;
  let planType = null;
  let planSelectRendered = false;

  function bubble(text, side = 'left', html = false) {
    const div = document.createElement('div');
    div.className = 'msg ' + side;
    if (html) div.innerHTML = text; else div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function toB64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function showPlanSelect() {
    if (planSelectRendered) return;
    planSelectRendered = true;
    bubble('Please select your insurance plan type:');
    const wrapper = document.createElement('div');
    wrapper.className = 'plan-select-wrapper';
    wrapper.innerHTML = `
      <select id="planSelect" class="plan-select">
        <option value="">Select plan type</option>
        <option value="PPO">PPO (Preferred Provider Organization)</option>
        <option value="POS">POS (Point of Service)</option>
        <option value="HMO">HMO (Health Maintenance Organization)</option>
        <option value="EPO">EPO (Exclusive Provider Organization)</option>
        <option value="MEDICARE">Medicare</option>
        <option value="MEDICAID">Medicaid</option>
        <option value="OTHER">Other / Not sure</option>
      </select>`;
    document.querySelector('.controls').appendChild(wrapper);
    const select = wrapper.querySelector('select');
    select.addEventListener('change', () => {
      planType = select.value;
      sendBtn.disabled = !(frontB64 && backB64 && planType);
    });
  }

  attachBtn.addEventListener('click', () => {
    if (!frontB64) frontInput.click(); else backInput.click();
  });

  frontInput.addEventListener('change', async () => {
    if (!frontInput.files.length) return;
    const file = frontInput.files[0];
    frontB64 = await toB64(file);
    bubble('Got the front.', 'right');
    if (!backB64) bubble('Now upload the BACK of the card.');
    if (frontB64 && backB64) {
      showPlanSelect();
      sendBtn.disabled = !(planType);
    }
  });

  backInput.addEventListener('change', async () => {
    if (!backInput.files.length) return;
    const file = backInput.files[0];
    backB64 = await toB64(file);
    bubble('Got the back.', 'right');
    if (frontB64 && backB64) {
      showPlanSelect();
      sendBtn.disabled = !(planType);
    }
  });

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    bubble('Checking…');
    try {
      const res = await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: frontB64, back: backB64, planType })
      });
      const data = await res.json();
      if (data.success) {
        bubble(data.message);
        setTimeout(() => { window.location.href = data.link; }, 1500);
      } else {
        bubble(data.message);
        setTimeout(() => { window.location.href = data.link || 'https://www.albertplasticsurgery.com/patient-resources/financing/'; }, 5500);
      }
    } catch (err) {
      console.error(err);
      bubble('Server error. Please try again later.');
    }
    sendBtn.disabled = false;
  });

  // Initial greeting
  bubble("Hi, I'm the intake assistant. Upload the FRONT of your insurance card, then the BACK.");
})();
