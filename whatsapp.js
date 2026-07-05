const screen = document.getElementById('wa-screen');
const input = document.getElementById('wa-input');
const sendBtn = document.getElementById('wa-send');
const phoneInput = document.getElementById('phone-input');

function addBubble(text, dir) {
  const div = document.createElement('div');
  div.className = `wa-bubble ${dir}`;
  div.textContent = text;
  screen.appendChild(div);
  screen.scrollTop = screen.scrollHeight;
}

async function sendMessage(text) {
  if (text) addBubble(text, 'in');
  const res = await fetch('/webhook/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: phoneInput.value.trim() || '+2348099998888', text }),
  });
  const data = await res.json();
  addBubble(data.reply || '(no reply)', 'out');
}

sendBtn.addEventListener('click', () => {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendMessage(text);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendBtn.click();
});

// open the conversation
sendMessage('');
