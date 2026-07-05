const chamberBody = document.getElementById('chamber-body');
const chamberSelect = document.getElementById('f-chamber');
const bookingsBody = document.getElementById('bookings-body');
const form = document.getElementById('book-form');

async function loadChambers() {
  const chambers = await fetch('/api/zecc/chambers').then(r => r.json());
  chamberBody.innerHTML = chambers.map(c => `
    <tr>
      <td>${c.name}</td>
      <td>${c.zone}</td>
      <td class="num-cell">${(c.capacity_kg - c.booked_kg).toFixed(0)}kg</td>
    </tr>
  `).join('');
  chamberSelect.innerHTML = chambers.map(c =>
    `<option value="${c.id}">${c.name} — ${(c.capacity_kg - c.booked_kg).toFixed(0)}kg free</option>`
  ).join('');
}

async function loadBookings() {
  const bookings = await fetch('/api/zecc/bookings').then(r => r.json());
  bookingsBody.innerHTML = bookings.map(b => `
    <tr>
      <td>${b.chamber} <span class="tag" style="margin-left:6px;">${b.zone}</span></td>
      <td>${b.farmer_name}</td>
      <td class="num-cell">${b.kg}kg</td>
      <td class="num-cell">${b.days}d</td>
      <td><span class="tag green">${b.status}</span></td>
    </tr>
  `).join('') || `<tr><td colspan="5" style="color:var(--ash);">No bookings yet.</td></tr>`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    chamber_id: Number(chamberSelect.value),
    farmer_name: document.getElementById('f-name').value.trim(),
    farmer_phone: document.getElementById('f-phone').value.trim(),
    kg: parseFloat(document.getElementById('f-kg').value),
    days: parseInt(document.getElementById('f-days').value, 10),
  };
  try {
    const res = await fetch('/api/zecc/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Booking failed');
    showToast('Chamber booked — slot reserved.');
    form.reset();
    document.getElementById('f-days').value = 3;
    await Promise.all([loadChambers(), loadBookings()]);
  } catch (err) {
    showToast(err.message, true);
  }
});

loadChambers();
loadBookings();
