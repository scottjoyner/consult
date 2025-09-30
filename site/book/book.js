const form = document.getElementById('book-form');
const status = document.getElementById('status');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = 'Preparing secure checkout…';
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.amount = 10000; payload.currency='usd';
  try {
    const res = await fetch('https://YOUR_BACKEND/stripe/checkout', {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json();
    window.location.href = data.url;
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
});
