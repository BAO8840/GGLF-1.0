const body = document.getElementById('ph-body');
const caption = document.getElementById('ph-caption');
const phoneInput = document.getElementById('phone-input');

let sessionId = null;
let accumulated = []; // full history of inputs this session, USSD-gateway style
let buffer = '';      // digits typed since last Send

function newSession() {
  sessionId = 'sess_' + Math.random().toString(36).slice(2, 10);
  accumulated = [];
  buffer = '';
}
newSession();

function renderBuffer() {
  caption.textContent = buffer ? `typing: ${buffer}` : 'dial *140# to start a session';
}

async function callUSSD(inputSegment) {
  const text = accumulated.concat(inputSegment ? [inputSegment] : []).join('*');
  const res = await fetch('/ussd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      phoneNumber: phoneInput.value.trim() || '+2348011112222',
      text,
    }),
  });
  const raw = await res.text(); // "CON ..." or "END ..."
  const reply = raw.replace(/^(CON|END)\s/, '');
  if (inputSegment) accumulated.push(inputSegment);
  body.innerHTML = escapeHtml(reply) + '<span class="cursor"></span>';
  if (raw.startsWith('END')) {
    setTimeout(() => { newSession(); body.innerHTML = 'Session ended.\n\nDial *140# to start again<span class="cursor"></span>'; renderBuffer(); }, 1200);
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

document.querySelectorAll('.key').forEach(btn => {
  btn.addEventListener('click', () => {
    const k = btn.dataset.k;
    if (k === 'clear') { buffer = ''; renderBuffer(); return; }
    if (k === 'send') {
      const seg = buffer;
      buffer = '';
      renderBuffer();
      callUSSD(seg);
      return;
    }
    buffer += k;
    renderBuffer();
  });
});

// first dial
callUSSD('');
