async function initTicker() {
  const el = document.getElementById('ticker');
  if (!el) return;

  async function load() {
    const prices = await fetch('/api/prices').then(r => r.json());
    el.innerHTML = prices.map(p => `
      <span class="ticker-chip" data-crop="${p.crop}">
        ${p.crop}: <span class="v">N${Number(p.farmer_price).toLocaleString()}/kg</span>
      </span>
    `).join('');
  }

  await load();

  const es = new EventSource('/api/stream');
  const pill = document.getElementById('conn-pill');
  es.onopen = () => { if (pill) { pill.classList.remove('off'); pill.innerHTML = '<span class="dot"></span> live · connected'; } };
  es.onerror = () => { if (pill) { pill.classList.add('off'); pill.innerHTML = '<span class="dot"></span> reconnecting…'; } };
  es.addEventListener('price_update', async () => {
    await load();
    document.querySelectorAll('.ticker-chip').forEach(chip => {
      chip.classList.add('flash');
      setTimeout(() => chip.classList.remove('flash'), 900);
    });
  });
}
initTicker();
