const form = document.getElementById('book-form');
const status = document.getElementById('status');

const backendMeta = document.querySelector('meta[name="consult-backend"]');
const backendBase = (window.cccAnalytics?.backendUrl || backendMeta?.content || '').replace(/\/$/, '');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = 'Preparing secure checkout…';
  window.cccAnalytics?.track('checkout_initiated', { form: 'clarity-call' });
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.amount = 10000; payload.currency='usd';
  try {
    if (!backendBase) throw new Error('Backend URL is not configured.');
    const res = await fetch(`${backendBase}/stripe/checkout`, {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json();
    window.cccAnalytics?.track('conversion', { source: 'clarity-call', stage: 'checkout-url-issued' });
    window.location.href = data.url;
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
});
