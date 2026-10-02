import { sendJson, gasRequest } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only.' });
  try {
    const result = await gasRequest('listReadings', {});
    return sendJson(res, 200, { ok: true, readings: result.readings || [] });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: String(error?.message || error) });
  }
}
