const backendMeta = document.querySelector('meta[name="consult-backend"]');
const backendUrl = (window.__CONSULT_BACKEND__ || backendMeta?.content || '').replace(/\/$/, '');
const sessionKey = 'ccc-session-id';
const consentKey = 'ccc-cookie-consent';
const queuedEvents = [];
let consentStatus = null;

try {
  consentStatus = localStorage.getItem(consentKey) || null;
} catch (err) {
  console.warn('Unable to read cookie consent preference', err);
}

function generateSessionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getSessionId() {
  let sessionId = null;
  try {
    sessionId = localStorage.getItem(sessionKey);
  } catch (err) {
    console.warn('Unable to read analytics session', err);
  }
  if (!sessionId) {
    sessionId = generateSessionId();
    try {
      localStorage.setItem(sessionKey, sessionId);
    } catch (err) {
      console.warn('Unable to persist analytics session', err);
    }
  }
  return sessionId;
}

const sessionId = getSessionId();

function buildCookieBanner() {
  if (document.getElementById('ccc-cookie-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'ccc-cookie-banner';
  banner.className = 'cookie-banner';
  banner.innerHTML = `
    <div class="cookie-banner__text">
      We use cookies to understand site usage and improve services. Review our
      <a href="/site/legal/privacy.html">Privacy Policy</a>,
      <a href="/site/legal/terms.html">Terms & Conditions</a>, and
      <a href="/site/legal/cookies.html">Cookie Notice</a>.
    </div>
    <div class="cookie-banner__actions">
      <button type="button" class="btn" data-action="accept">Accept</button>
      <button type="button" class="btn ghost" data-action="decline">Decline</button>
    </div>
  `;
  banner.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action;
    if (!action) return;
    if (action === 'accept') {
      updateConsent('accepted');
    } else if (action === 'decline') {
      updateConsent('declined');
    }
  });
  document.body.appendChild(banner);
}

function updateConsent(status) {
  consentStatus = status;
  try {
    localStorage.setItem(consentKey, status);
  } catch (err) {
    console.warn('Unable to persist cookie consent status', err);
  }
  const banner = document.getElementById('ccc-cookie-banner');
  if (banner) {
    banner.classList.add('cookie-banner--hidden');
    setTimeout(() => banner.remove(), 400);
  }
  if (status === 'accepted') {
    flushQueue();
    track('visit', {
      path: window.location.pathname,
      title: document.title,
      referrer: document.referrer || null
    });
    refreshMetrics();
  } else {
    queuedEvents.length = 0;
  }
}

function sendEvent(event) {
  if (!backendUrl) return Promise.resolve();
  return fetch(`${backendUrl}/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: event.eventType,
      sessionId,
      page: event.page || window.location.pathname,
      properties: event.properties || {}
    })
  }).catch((err) => {
    console.warn('Analytics request failed', err);
  });
}

function flushQueue() {
  while (queuedEvents.length) {
    const event = queuedEvents.shift();
    sendEvent(event);
  }
}

function track(eventType, properties = {}) {
  const event = { eventType, properties, page: window.location.pathname };
  if (consentStatus === 'accepted') {
    sendEvent(event);
  } else {
    queuedEvents.push(event);
  }
}

function handleAutoEvents() {
  document.addEventListener('click', (event) => {
    const actionable = event.target.closest('[data-analytics-event]');
    if (!actionable) return;
    const name = actionable.dataset.analyticsEvent;
    let details = {};
    if (actionable.dataset.analyticsProperties) {
      try {
        details = JSON.parse(actionable.dataset.analyticsProperties);
      } catch (err) {
        console.warn('Invalid analytics payload on element', actionable, err);
      }
    }
    if (!details.label && actionable.textContent) {
      details.label = actionable.textContent.trim().slice(0, 120);
    }
    track(name, details);
  });
}

async function refreshMetrics() {
  const metricsRoot = document.querySelector('[data-analytics-metrics]');
  if (!metricsRoot || !backendUrl) return;
  try {
    const response = await fetch(`${backendUrl}/analytics/metrics`);
    if (!response.ok) return;
    const data = await response.json();
    const setValue = (selector, value) => {
      const node = metricsRoot.querySelector(selector);
      if (node) node.textContent = value;
    };
    setValue('[data-metric="visitors"]', data.visitors ?? '0');
    setValue('[data-metric="events"]', data.totalEvents ?? '0');
    setValue('[data-metric="conversions"]', data.conversions ?? '0');
    const rate = data.conversionRate != null ? `${(data.conversionRate * 100).toFixed(1)}%` : '0%';
    setValue('[data-metric="conversion-rate"]', rate);
  } catch (err) {
    console.warn('Failed to load analytics metrics', err);
  }
}

handleAutoEvents();

if (consentStatus === 'accepted') {
  track('visit', {
    path: window.location.pathname,
    title: document.title,
    referrer: document.referrer || null
  });
  refreshMetrics();
} else {
  buildCookieBanner();
}

refreshMetrics();

window.cccAnalytics = {
  backendUrl,
  track,
  consentStatus: () => consentStatus,
  refreshMetrics
};

if ('serviceWorker' in navigator && backendUrl) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'ccc-analytics') {
      track(event.data.eventType, event.data.properties);
    }
  });
}
