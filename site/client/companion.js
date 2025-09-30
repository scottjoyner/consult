const shell = document.getElementById('chat-shell');
const lockout = document.getElementById('lockout');
const chatLog = document.getElementById('chat-log');
const form = document.getElementById('chat-form');
const clearBtn = document.getElementById('clear-chat');
const paid = (() => {
  try {
    return localStorage.getItem('campbellcognition_client_paid') === 'true';
  } catch (_) {
    return false;
  }
})();

const STORAGE_KEY = 'campbellcognition_companion_history';

function appendMessage(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
  persistHistory();
  return bubble;
}

function persistHistory() {
  if (!paid) return;
  try {
    const transcript = Array.from(chatLog.children).map(node => ({
      role: node.classList.contains('user') ? 'user' : 'assistant',
      content: node.textContent
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transcript));
  } catch (err) {
    console.warn('Unable to persist companion history', err);
  }
}

function hydrateHistory() {
  if (!paid) return;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    saved.forEach(entry => appendMessage(entry.role, entry.content));
  } catch (err) {
    console.warn('Unable to load companion history', err);
  }
}

if (paid) {
  shell.classList.remove('hidden');
  shell.setAttribute('aria-hidden', 'false');
  lockout.classList.add('hidden');
  hydrateHistory();
  if (!chatLog.children.length) {
    appendMessage('assistant', 'Welcome back to the Campbell Companion. Share the architecture or AI questions you want us to prep before the next call.');
  }
} else if (form) {
  form.classList.add('hidden');
}

async function sendToBackend(message) {
  const endpoint = 'https://YOUR_BACKEND/client/companion';
  const body = { message };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`Backend error (${res.status})`);
  }
  return res.json();
}

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!paid) {
      alert('Access is limited to active Campbell Cognition clients.');
      return;
    }
    const data = new FormData(form);
    const message = (data.get('message') || '').toString().trim();
    if (!message) return;

    appendMessage('user', message);
    const thinkingBubble = appendMessage('assistant', 'One sec… synthesizing a response.');
    form.reset();

    try {
      const payload = await sendToBackend(message);
      const reply = payload?.reply || 'Your AI workspace is ready to respond once the backend URL is configured.';
      thinkingBubble.textContent = reply;
    } catch (err) {
      console.error(err);
      thinkingBubble.textContent = 'We could not reach the AI workspace. Check the backend URL or try again later.';
    }
    persistHistory();
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (!paid) return;
    chatLog.innerHTML = '';
    persistHistory();
    appendMessage('assistant', 'History cleared. Let us know what you\'d like to tackle next before our next gathering.');
  });
}
