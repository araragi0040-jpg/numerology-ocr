export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is not configured.`);
  return value;
}

export async function gasRequest(action, payload = {}) {
  const url = requireEnv('GAS_WEB_APP_URL');
  const sharedSecret = requireEnv('GAS_SHARED_SECRET');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({
      action,
      secret: sharedSecret,
      ...payload,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned a non-JSON response (${response.status}).`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(data?.error || `Apps Script request failed (${response.status}).`);
  }
  return data;
}

export function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Invalid image data.');
  return { mimeType: match[1], base64: match[2] };
}

export function sanitizeFilename(name = 'numerology-record.jpg') {
  const safe = String(name).replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim();
  return safe || 'numerology-record.jpg';
}
