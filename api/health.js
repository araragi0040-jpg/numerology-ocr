import { sendJson, gasRequest } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only.' });
  try {
    const gas = await gasRequest('health', {});
    return sendJson(res, 200, {
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      gasConfigured: Boolean(process.env.GAS_WEB_APP_URL && process.env.GAS_SHARED_SECRET),
      gas
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: String(error?.message || error) });
  }
}
