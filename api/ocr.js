import { sendJson, readJsonBody, requireEnv, gasRequest, parseDataUrl, sanitizeFilename } from './_shared.js';

const OCR_SCHEMA = {
  type: 'object',
  properties: {
    person: {
      type: 'object',
      properties: {
        name_ja: { type: 'string', description: 'Japanese full name exactly as written, otherwise empty string.' },
        name_kana: { type: 'string', description: 'Kana reading only if explicitly written, otherwise empty string.' },
        roman_name: { type: 'string', description: 'Romanized name exactly as written, otherwise empty string.' },
        birth_date: { type: 'string', description: 'Birth date normalized to YYYY-MM-DD only when clearly readable, otherwise empty string.' }
      },
      required: ['name_ja', 'name_kana', 'roman_name', 'birth_date']
    },
    numerology: {
      type: 'object',
      properties: {
        shukumei_number: { type: ['integer', 'null'], description: '宿命数. Null if unclear.' },
        unmei_number: { type: ['integer', 'null'], description: '運命数. Null if unclear.' },
        name_calculation: { type: 'string', description: 'Name-related calculation memo/sums exactly enough to preserve the handwritten calculation.' }
      },
      required: ['shukumei_number', 'unmei_number', 'name_calculation']
    },
    sections: {
      type: 'object',
      properties: {
        shukumei_description: { type: 'string' },
        unmei_description: { type: 'string' },
        strengths: { type: 'string' },
        weaknesses: { type: 'string' },
        love: { type: 'string' },
        work: { type: 'string' },
        notes: { type: 'string' }
      },
      required: ['shukumei_description', 'unmei_description', 'strengths', 'weaknesses', 'love', 'work', 'notes']
    },
    other_sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['label', 'content']
      }
    },
    uncertain_fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Dot path such as sections.work or person.name_ja.' },
          label: { type: 'string' },
          read_value: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['field', 'label', 'read_value', 'reason']
      }
    },
    raw_transcription: { type: 'string', description: 'Best-effort transcription of all visible handwritten text. Keep line breaks where useful.' }
  },
  required: ['person', 'numerology', 'sections', 'other_sections', 'uncertain_fields', 'raw_transcription']
};

const OCR_PROMPT = `
You are extracting a Japanese handwritten numerology consultation sheet into structured data.
The image may contain blue/black main text, red annotations/calculations, arrows, circled numbers, and freehand notes.

Rules:
1. Do not invent missing characters or numbers. If unclear, leave the target string empty or number null and add an item to uncertain_fields.
2. Preserve the meaning and wording of handwritten Japanese. Do not rewrite into polished prose.
3. Distinguish the fixed sections where possible: 宿命数, 運命数, 長所, 短所, 愛/恋愛, 仕事.
4. Birth date: normalize to YYYY-MM-DD only if year/month/day are all clearly visible.
5. 宿命数 and 運命数: extract the explicitly written/circled result. Do not calculate a replacement when the written value is unclear.
6. Name calculation: preserve visible roman letters, digit sequences, plus signs, subtotal/total memos. If part is unreadable, preserve the readable pieces and flag uncertainty.
7. Any headings/notes that do not fit the fixed fields go to other_sections.
8. raw_transcription should capture as much visible text as possible, including calculation lines.
9. Output only JSON matching the requested schema.
`;

function safeJsonParse(text) {
  const trimmed = String(text || '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(fenced);
}

async function callGemini({ base64, mimeType }) {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: OCR_PROMPT }
        ]
      }],
      generationConfig: {
        temperature: 0,
        responseFormat: {
          text: {
            mimeType: 'application/json',
            schema: OCR_SCHEMA
          }
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini API request failed (${response.status}).`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned no extractable text.');
  return safeJsonParse(text);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only.' });

  let ocrId = '';
  try {
    const body = await readJsonBody(req);
    const { imageDataUrl, fileName } = body;
    const { mimeType, base64 } = parseDataUrl(imageDataUrl);

    if (!/^image\/(jpeg|png|webp)$/i.test(mimeType)) {
      throw new Error('JPEG / PNG / WebP image only.');
    }
    if (base64.length > 4_000_000) {
      throw new Error('Image is too large. Please retake or select a smaller image.');
    }

    const pending = await gasRequest('startOcr', {
      fileName: sanitizeFilename(fileName),
      mimeType,
      base64,
    });
    ocrId = pending.ocrId;

    const extracted = await callGemini({ base64, mimeType });

    await gasRequest('finishOcr', {
      ocrId,
      extracted,
      status: '確認待ち'
    });

    return sendJson(res, 200, {
      ok: true,
      ocrId,
      imageFileId: pending.imageFileId,
      imageUrl: pending.imageUrl,
      extracted,
    });
  } catch (error) {
    if (ocrId) {
      try {
        await gasRequest('finishOcr', {
          ocrId,
          status: 'エラー',
          errorMessage: String(error?.message || error)
        });
      } catch {}
    }
    return sendJson(res, 500, { ok: false, error: String(error?.message || error) });
  }
}
