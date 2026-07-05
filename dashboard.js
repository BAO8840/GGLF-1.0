const priceBody = document.getElementById('price-body');
const listingsBody = document.getElementById('listings-body');
const logBody = document.getElementById('log-body');
const connPill = document.getElementById('conn-pill');

function fmt(n) { return Number(n).toLocaleString(); }
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function renderPrices(rows) {
  priceBody.innerHTML = rows.map(r => `
    <tr data-id="${r.id}">
      <td>${r.crop}</td>
      <td>${r.zone}</td>
      <td class="num-cell">N<span class="mv">${fmt(r.market_price)}</span>/kg</td>
      <td class="num-cell">
        <input class="fp-input" data-id="${r.id}" type="number" value="${r.farmer_price}" style="width:100px; display:inline-block;">
      </td>
      <td class="num-cell" style="color:var(--gold);">+N${fmt(r.market_price - r.farmer_price)}</td>
      <td style="color:var(--ash); font-size:12.5px;">${timeAgo(r.updated_at)}</td>
      <td><button class="btn small save-btn" data-id="${r.id}">Save</button></td>
    </tr>
  `).join('');

  document.querySelectorAll('.save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const input = document.querySelector(`.fp-input[data-id="${id}"]`);
      const farmer_price = parseFloat(input.value);
      btn.disabled = true;
      try {
        const res = await fetch(`/api/prices/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ farmer_price }),
        });
        if (!res.ok) throw new Error('save failed');
        showToast('Price updated — pushed live to all channels.');
      } catch (e) {
        showToast('Could not save price.', true);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderListings(rows) {
  listingsBody.innerHTML = rows.map(r => `
    <tr>
      <td class="mono">${r.farmer_phone}</td>
      <td>${r.crop}</td>
      <td class="num-cell">${r.kg}kg</td>
      <td><span class="tag ${r.status === 'open' ? 'green' : ''}">${r.status}</span></td>
      <td style="color:var(--ash); font-size:12.5px;">${timeAgo(r.created_at)}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" style="color:var(--ash);">No listings yet — report a harvest from the USSD or WhatsApp simulator.</td></tr>`;
}

function renderLog(rows) {
  logBody.innerHTML = rows.map(r => `
    <tr>
      <td><span class="tag ${r.channel === 'whatsapp' ? 'green' : 'gold'}">${r.channel}</span></td>
      <td class="mono">${r.phone || '—'}</td>
      <td>${r.direction === 'in' ? '→ bot' : '← bot'}</td>
      <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ash);">${(r.text || '').replace(/\n/g, ' / ')}</td>
    </tr>
  `).join('') || `<tr><td colspan="4" style="color:var(--ash);">No activity yet — try the USSD or WhatsApp simulator.</td></tr>`;
}

async function loadAll() {
  const [prices, listings, log] = await Promise.all([
    fetch('/api/prices').then(r => r.json()),
    fetch('/api/listings').then(r => r.json()),
    fetch('/api/messages').then(r => r.json()),
  ]);
  renderPrices(prices);
  renderListings(listings);
  renderLog(log);
}

loadAll();
setInterval(() => { loadAll(); }, 8000); // fallback refresh for listings/log (not push-based)

// live price + activity stream
const es = new EventSource('/api/stream');
es.onopen = () => {
  connPill.classList.remove('off');
  connPill.innerHTML = '<span class="dot"></span> live · connected';
};
es.onerror = () => {
  connPill.classList.add('off');
  connPill.innerHTML = '<span class="dot"></span> reconnecting…';
};
es.addEventListener('price_update', (e) => {
  const p = JSON.parse(e.data);
  const row = document.querySelector(`tr[data-id="${p.id}"]`);
  if (row) {
    row.querySelector('.mv').textContent = Number(p.market_price).toLocaleString();
  }
  loadAll();
});
