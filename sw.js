// Service Worker Instant Streamer for Google Drive Raw Media (Zero Virus Warning & Auto-Pacer Retry)
let cachedToken = '';
let tokenExpiry = 0;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function getValidToken(cid, sec, rt) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }
  const body = new URLSearchParams({
    client_id: cid,
    client_secret: sec,
    refresh_token: rt,
    grant_type: 'refresh_token'
  });
  for (let i = 0; i < 8; i++) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (res.ok) {
      const data = await res.json();
      cachedToken = data.access_token;
      tokenExpiry = Date.now() + ((data.expires_in || 3500) - 300) * 1000;
      return cachedToken;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Failed to refresh Google OAuth token');
}

async function streamFromDrive(request, fileId, cid, sec, rt) {
  const rangeHdr = request.headers.get('range');
  for (let attempt = 0; attempt < 15; attempt++) {
    const token = await getValidToken(cid, sec, rt);
    const headers = new Headers();
    headers.set('Authorization', 'Bearer ' + token);
    if (rangeHdr) {
      headers.set('Range', rangeHdr);
    } else {
      headers.set('Range', 'bytes=0-');
    }

    const driveUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&acknowledgeAbuse=true';
    const upstream = await fetch(driveUrl, {
      method: 'GET',
      headers,
      mode: 'cors',
      credentials: 'omit'
    });

    if (upstream.status === 200 || upstream.status === 206) {
      return upstream;
    }
    if (upstream.status === 401) {
      cachedToken = '';
      tokenExpiry = 0;
      continue;
    }
    if (upstream.status !== 403 && upstream.status !== 429 && upstream.status < 500) {
      return upstream;
    }
    await new Promise(r => setTimeout(r, 1400));
  }
  return new Response('Google Drive sedang sibuk, silakan muat ulang.', { status: 503 });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const idx = url.pathname.indexOf('/__stream/');
  if (idx === -1) return;

  const fileId = decodeURIComponent(url.pathname.slice(idx + '/__stream/'.length));
  const cid = url.searchParams.get('cid') || '';
  const sec = url.searchParams.get('sec') || '';
  const rt = url.searchParams.get('rt') || '';

  if (!fileId || !cid || !sec || !rt) {
    event.respondWith(new Response('Missing stream auth params', { status: 400 }));
    return;
  }

  event.respondWith(streamFromDrive(event.request, fileId, cid, sec, rt));
});
