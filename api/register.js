import { sendJson, readJsonBody, gasRequest } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only.' });
  try {
    const body = await readJsonBody(req);
    const { ocrId, imageFileId, imageUrl, data } = body;
    if (!ocrId || !data) throw new Error('Missing OCR ID or form data.');

    const result = await gasRequest('confirmReading', {
      ocrId,
      imageFileId: imageFileId || '',
      imageUrl: imageUrl || '',
      data,
      source: 'PHOTO'
    });
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: String(error?.message || error) });
  }
}
