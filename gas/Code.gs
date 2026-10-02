const APP_VERSION = 'v001';
const SHEETS = {
  PEOPLE: '人物マスタ',
  READINGS: '鑑定記録',
  DETAILS: '鑑定詳細',
  OCR: 'OCR受付'
};

const HEADERS = {};
HEADERS[SHEETS.PEOPLE] = ['person_id', '氏名', 'ふりがな', 'ローマ字', '生年月日', '作成日時', '更新日時'];
HEADERS[SHEETS.READINGS] = ['reading_id', 'person_id', '鑑定日', '宿命数', '運命数', '姓名計算メモ', '元画像URL', '元画像FileID', '登録方法', 'ocr_id', '作成日時', '更新日時'];
HEADERS[SHEETS.DETAILS] = ['detail_id', 'reading_id', '項目キー', '項目名', '内容', '並び順'];
HEADERS[SHEETS.OCR] = ['ocr_id', '受付日時', '状態', '元画像URL', '元画像FileID', '元ファイル名', 'OCR結果JSON', 'エラー', '確定reading_id', '更新日時'];

function setupNumerologyV001() {
  const props = PropertiesService.getScriptProperties();

  let spreadsheetId = props.getProperty('SPREADSHEET_ID');
  let ss;
  if (!spreadsheetId) {
    ss = SpreadsheetApp.create('数秘鑑定管理_v001');
    spreadsheetId = ss.getId();
    props.setProperty('SPREADSHEET_ID', spreadsheetId);
  } else {
    ss = SpreadsheetApp.openById(spreadsheetId);
  }

  Object.keys(HEADERS).forEach(name => ensureSheet_(ss, name, HEADERS[name]));

  let folderId = props.getProperty('DRIVE_FOLDER_ID');
  let folder;
  if (!folderId) {
    folder = DriveApp.createFolder('数秘鑑定_OCR原本_v001');
    folderId = folder.getId();
    props.setProperty('DRIVE_FOLDER_ID', folderId);
  } else {
    folder = DriveApp.getFolderById(folderId);
  }

  let sharedSecret = props.getProperty('API_SHARED_SECRET');
  if (!sharedSecret) {
    sharedSecret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('API_SHARED_SECRET', sharedSecret);
  }

  Logger.log('=== 数秘鑑定 OCR v001 セットアップ完了 ===');
  Logger.log('Spreadsheet URL: ' + ss.getUrl());
  Logger.log('Drive Folder URL: https://drive.google.com/drive/folders/' + folder.getId());
  Logger.log('GAS_SHARED_SECRET: ' + sharedSecret);
  Logger.log('次に Webアプリとしてデプロイし、URLを Vercel の GAS_WEB_APP_URL に設定してください。');
}

function doGet() {
  return json_({ ok: true, app: 'numerology-ocr', version: APP_VERSION });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    authorize_(body.secret);

    switch (body.action) {
      case 'health': return json_({ ok: true, version: APP_VERSION });
      case 'startOcr': return json_(startOcr_(body));
      case 'finishOcr': return json_(finishOcr_(body));
      case 'confirmReading': return json_(confirmReading_(body));
      case 'listReadings': return json_(listReadings_());
      default: throw new Error('Unknown action: ' + body.action);
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function authorize_(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_SHARED_SECRET');
  if (!expected || secret !== expected) throw new Error('Unauthorized.');
}

function getSs_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID is not configured. Run setupNumerologyV001().');
  return SpreadsheetApp.openById(id);
}

function getFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  if (!id) throw new Error('DRIVE_FOLDER_ID is not configured. Run setupNumerologyV001().');
  return DriveApp.getFolderById(id);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function startOcr_(body) {
  const base64 = String(body.base64 || '');
  if (!base64) throw new Error('Image data is empty.');

  const mimeType = String(body.mimeType || 'image/jpeg');
  const fileName = safeFileName_(body.fileName || ('numerology_' + formatDate_(new Date(), 'yyyyMMdd_HHmmss') + '.jpg'));
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = getFolder_().createFile(blob);
  const imageFileId = file.getId();
  const imageUrl = file.getUrl();
  const ocrId = makeId_('OCR');
  const now = new Date();

  const sh = getSs_().getSheetByName(SHEETS.OCR);
  sh.appendRow([ocrId, now, 'AI読取中', imageUrl, imageFileId, fileName, '', '', '', now]);

  return { ok: true, ocrId: ocrId, imageFileId: imageFileId, imageUrl: imageUrl };
}

function finishOcr_(body) {
  const ocrId = String(body.ocrId || '');
  if (!ocrId) throw new Error('ocrId is required.');
  const sh = getSs_().getSheetByName(SHEETS.OCR);
  const row = findRowByValue_(sh, 1, ocrId);
  if (!row) throw new Error('OCR row not found: ' + ocrId);

  const status = body.status || '確認待ち';
  const extractedJson = body.extracted ? JSON.stringify(body.extracted) : '';
  const errorMessage = body.errorMessage || '';
  sh.getRange(row, 3).setValue(status);
  if (extractedJson) sh.getRange(row, 7).setValue(extractedJson);
  if (errorMessage) sh.getRange(row, 8).setValue(errorMessage);
  sh.getRange(row, 10).setValue(new Date());
  return { ok: true };
}

function confirmReading_(body) {
  const data = body.data || {};
  const person = data.person || {};
  const numerology = data.numerology || {};
  const sections = data.sections || {};
  const otherSections = Array.isArray(data.other_sections) ? data.other_sections : [];
  const ocrId = String(body.ocrId || '');
  if (!ocrId) throw new Error('ocrId is required.');
  if (!String(person.name_ja || '').trim() && !String(person.roman_name || '').trim()) {
    throw new Error('氏名またはローマ字名のどちらかを入力してください。');
  }

  const ss = getSs_();
  const now = new Date();
  const personId = upsertPerson_(ss, person, now);
  const readingId = makeId_('R');
  const readingDate = now;

  const readings = ss.getSheetByName(SHEETS.READINGS);
  readings.appendRow([
    readingId,
    personId,
    readingDate,
    valueOrBlank_(numerology.shukumei_number),
    valueOrBlank_(numerology.unmei_number),
    String(numerology.name_calculation || ''),
    String(body.imageUrl || ''),
    String(body.imageFileId || ''),
    String(body.source || 'PHOTO'),
    ocrId,
    now,
    now
  ]);

  const details = [
    ['shukumei_description', '宿命数', sections.shukumei_description || ''],
    ['unmei_description', '運命数', sections.unmei_description || ''],
    ['strengths', '長所', sections.strengths || ''],
    ['weaknesses', '短所', sections.weaknesses || ''],
    ['love', '愛・恋愛', sections.love || ''],
    ['work', '仕事', sections.work || ''],
    ['notes', '備考', sections.notes || ''],
    ['raw_transcription', '全文文字起こし', data.raw_transcription || '']
  ];

  otherSections.forEach(function(item, idx) {
    details.push(['other_' + (idx + 1), String(item.label || ('その他' + (idx + 1))), String(item.content || '')]);
  });

  const detailSheet = ss.getSheetByName(SHEETS.DETAILS);
  const rows = details
    .filter(function(x) { return String(x[2] || '').trim() !== ''; })
    .map(function(x, idx) {
      return [makeId_('D'), readingId, x[0], x[1], x[2], idx + 1];
    });
  if (rows.length) {
    detailSheet.getRange(detailSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  const ocrSheet = ss.getSheetByName(SHEETS.OCR);
  const ocrRow = findRowByValue_(ocrSheet, 1, ocrId);
  if (ocrRow) {
    ocrSheet.getRange(ocrRow, 3).setValue('確定');
    ocrSheet.getRange(ocrRow, 9).setValue(readingId);
    ocrSheet.getRange(ocrRow, 10).setValue(now);
  }

  return { ok: true, readingId: readingId, personId: personId };
}

function upsertPerson_(ss, person, now) {
  const sh = ss.getSheetByName(SHEETS.PEOPLE);
  const values = sh.getDataRange().getValues();
  const name = normalize_(person.name_ja || '');
  const roman = normalize_(person.roman_name || '');
  const birth = String(person.birth_date || '').trim();

  for (let i = 1; i < values.length; i++) {
    const rowName = normalize_(values[i][1]);
    const rowRoman = normalize_(values[i][3]);
    const rowBirth = formatStoredDate_(values[i][4]);
    const sameBirth = birth && rowBirth === birth;
    const sameName = name && rowName === name;
    const sameRoman = roman && rowRoman === roman;
    if (sameBirth && (sameName || sameRoman)) {
      const row = i + 1;
      if (person.name_ja) sh.getRange(row, 2).setValue(person.name_ja);
      if (person.name_kana) sh.getRange(row, 3).setValue(person.name_kana);
      if (person.roman_name) sh.getRange(row, 4).setValue(person.roman_name);
      if (birth) sh.getRange(row, 5).setValue(parseIsoDate_(birth));
      sh.getRange(row, 7).setValue(now);
      return String(values[i][0]);
    }
  }

  const personId = makeId_('P');
  sh.appendRow([
    personId,
    person.name_ja || '',
    person.name_kana || '',
    person.roman_name || '',
    birth ? parseIsoDate_(birth) : '',
    now,
    now
  ]);
  return personId;
}

function listReadings_() {
  const ss = getSs_();
  const peopleSheet = ss.getSheetByName(SHEETS.PEOPLE);
  const readingsSheet = ss.getSheetByName(SHEETS.READINGS);
  const detailsSheet = ss.getSheetByName(SHEETS.DETAILS);

  const peopleRows = peopleSheet.getDataRange().getValues();
  const people = {};
  for (let i = 1; i < peopleRows.length; i++) {
    people[String(peopleRows[i][0])] = {
      name_ja: peopleRows[i][1] || '',
      name_kana: peopleRows[i][2] || '',
      roman_name: peopleRows[i][3] || '',
      birth_date: formatStoredDate_(peopleRows[i][4])
    };
  }

  const detailsRows = detailsSheet.getDataRange().getValues();
  const detailsByReading = {};
  for (let i = 1; i < detailsRows.length; i++) {
    const readingId = String(detailsRows[i][1]);
    if (!detailsByReading[readingId]) detailsByReading[readingId] = [];
    detailsByReading[readingId].push({
      key: detailsRows[i][2] || '',
      label: detailsRows[i][3] || '',
      content: detailsRows[i][4] || '',
      order: Number(detailsRows[i][5] || 0)
    });
  }

  const rows = readingsSheet.getDataRange().getValues();
  const result = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const r = rows[i];
    const readingId = String(r[0]);
    result.push({
      reading_id: readingId,
      person_id: String(r[1] || ''),
      reading_date: formatStoredDateTime_(r[2]),
      shukumei_number: r[3] === '' ? null : Number(r[3]),
      unmei_number: r[4] === '' ? null : Number(r[4]),
      name_calculation: r[5] || '',
      image_url: r[6] || '',
      source: r[8] || '',
      ocr_id: r[9] || '',
      person: people[String(r[1])] || {},
      details: (detailsByReading[readingId] || []).sort(function(a, b) { return a.order - b.order; })
    });
  }
  return { ok: true, readings: result.slice(0, 500) };
}

function findRowByValue_(sheet, col, value) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const vals = sheet.getRange(2, col, last - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(value)) return i + 2;
  }
  return 0;
}

function makeId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function normalize_(v) {
  return String(v || '').toLowerCase().replace(/[\s　]/g, '');
}

function valueOrBlank_(v) {
  return (v === null || typeof v === 'undefined' || v === '') ? '' : v;
}

function parseIsoDate_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return s || '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatStoredDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return formatDate_(v, 'yyyy-MM-dd');
  }
  return String(v || '');
}

function formatStoredDateTime_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return formatDate_(v, 'yyyy-MM-dd HH:mm');
  }
  return String(v || '');
}

function formatDate_(date, pattern) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Tokyo', pattern);
}

function safeFileName_(name) {
  return String(name || 'numerology-record.jpg').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 180);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
