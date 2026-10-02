const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  imageDataUrl: '',
  fileName: '',
  ocrId: '',
  imageFileId: '',
  imageUrl: '',
  extracted: null,
  readings: []
};

const fieldNames = [
  'name_ja','name_kana','roman_name','birth_date','shukumei_number','unmei_number','name_calculation',
  'shukumei_description','unmei_description','strengths','weaknesses','love','work','notes','raw_transcription'
];

function showStep(id) {
  $$('.step').forEach(el => el.classList.toggle('active', el.id === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('#capturePanel').classList.toggle('active', name === 'capture');
  $('#listPanel').classList.toggle('active', name === 'list');
  if (name === 'list') loadReadings();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `通信エラー (${res.status})`);
  return data;
}

async function checkHealth() {
  const status = $('#statusDot');
  try {
    await api('/api/health');
    status.className = 'status ok';
    status.querySelector('span').textContent = '接続済み';
  } catch {
    status.className = 'status ng';
    status.querySelector('span').textContent = '設定確認';
  }
}

async function compressImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });

  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .82);
}

async function handleImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('画像ファイルを選択してください');
  try {
    showStep('stepProcessing');
    $('#progressBar').style.width = '18%';
    $('#processingText').textContent = '画像を見やすいサイズに整えています';

    const imageDataUrl = await compressImage(file);
    state.imageDataUrl = imageDataUrl;
    state.fileName = (file.name || 'numerology-record.jpg').replace(/\.[^.]+$/, '') + '.jpg';
    $('#previewImage').src = imageDataUrl;

    $('#progressBar').style.width = '38%';
    $('#processingText').textContent = 'Driveに原本を保存しています';

    const data = await api('/api/ocr', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl, fileName: state.fileName })
    });

    $('#progressBar').style.width = '100%';
    state.ocrId = data.ocrId;
    state.imageFileId = data.imageFileId;
    state.imageUrl = data.imageUrl;
    state.extracted = data.extracted;
    fillReview(data.extracted);
    $('#driveImageLink').href = data.imageUrl || '#';
    setTimeout(() => showStep('stepReview'), 180);
  } catch (err) {
    console.error(err);
    toast(err.message || '読み取りに失敗しました');
    showStep('stepUpload');
  } finally {
    $('#cameraInput').value = '';
    $('#galleryInput').value = '';
  }
}

function setField(name, value) {
  const el = document.querySelector(`[name="${name}"]`);
  if (!el) return;
  el.value = value ?? '';
}

function fillReview(data) {
  const p = data?.person || {};
  const n = data?.numerology || {};
  const s = data?.sections || {};
  setField('name_ja', p.name_ja);
  setField('name_kana', p.name_kana);
  setField('roman_name', p.roman_name);
  setField('birth_date', /^\d{4}-\d{2}-\d{2}$/.test(p.birth_date || '') ? p.birth_date : '');
  setField('shukumei_number', n.shukumei_number);
  setField('unmei_number', n.unmei_number);
  setField('name_calculation', n.name_calculation);
  setField('shukumei_description', s.shukumei_description);
  setField('unmei_description', s.unmei_description);
  setField('strengths', s.strengths);
  setField('weaknesses', s.weaknesses);
  setField('love', s.love);
  setField('work', s.work);
  setField('notes', s.notes);
  setField('raw_transcription', data?.raw_transcription);

  $('#otherSections').innerHTML = '';
  (data?.other_sections || []).forEach(item => addOtherRow(item.label, item.content));

  const uncertain = data?.uncertain_fields || [];
  const box = $('#warningBox');
  if (uncertain.length) {
    box.classList.remove('hidden');
    box.innerHTML = `<strong>⚠ ${uncertain.length}か所、AIが読み取りに自信を持てませんでした</strong>` +
      uncertain.map(x => `・${escapeHtml(x.label || x.field)}：${escapeHtml(x.read_value || '空欄')} <small>(${escapeHtml(x.reason || '')})</small>`).join('<br>');
  } else {
    box.classList.add('hidden');
    box.innerHTML = '';
  }
}

function addOtherRow(label = '', content = '') {
  const row = document.createElement('div');
  row.className = 'other-row';
  row.innerHTML = `
    <input class="other-label" type="text" placeholder="項目名" value="${escapeAttr(label)}" />
    <textarea class="other-content" rows="2" placeholder="内容">${escapeHtml(content)}</textarea>
    <button type="button" title="削除">×</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('#otherSections').appendChild(row);
}

function collectReview() {
  const form = $('#reviewForm');
  const val = (name) => form.elements[name]?.value?.trim() || '';
  const num = (name) => val(name) === '' ? null : Number(val(name));
  return {
    person: {
      name_ja: val('name_ja'),
      name_kana: val('name_kana'),
      roman_name: val('roman_name'),
      birth_date: val('birth_date')
    },
    numerology: {
      shukumei_number: num('shukumei_number'),
      unmei_number: num('unmei_number'),
      name_calculation: val('name_calculation')
    },
    sections: {
      shukumei_description: val('shukumei_description'),
      unmei_description: val('unmei_description'),
      strengths: val('strengths'),
      weaknesses: val('weaknesses'),
      love: val('love'),
      work: val('work'),
      notes: val('notes')
    },
    other_sections: $$('#otherSections .other-row').map(row => ({
      label: row.querySelector('.other-label').value.trim(),
      content: row.querySelector('.other-content').value.trim()
    })).filter(x => x.label || x.content),
    uncertain_fields: state.extracted?.uncertain_fields || [],
    raw_transcription: val('raw_transcription')
  };
}

async function registerReading(event) {
  event.preventDefault();
  const data = collectReview();
  if (!data.person.name_ja && !data.person.roman_name) return toast('氏名またはローマ字名を入力してください');
  const button = $('#registerButton');
  button.disabled = true;
  button.textContent = '登録中…';
  try {
    const result = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        ocrId: state.ocrId,
        imageFileId: state.imageFileId,
        imageUrl: state.imageUrl,
        data
      })
    });
    $('#doneText').textContent = `登録ID：${result.readingId}`;
    showStep('stepDone');
  } catch (err) {
    toast(err.message || '登録に失敗しました');
  } finally {
    button.disabled = false;
    button.textContent = 'この内容で確定登録';
  }
}

function resetCapture() {
  state.imageDataUrl = '';
  state.fileName = '';
  state.ocrId = '';
  state.imageFileId = '';
  state.imageUrl = '';
  state.extracted = null;
  fieldNames.forEach(name => setField(name, ''));
  $('#otherSections').innerHTML = '';
  $('#warningBox').classList.add('hidden');
  $('#previewImage').removeAttribute('src');
  $('#progressBar').style.width = '15%';
  showStep('stepUpload');
}

async function loadReadings() {
  const list = $('#recordList');
  const msg = $('#listMessage');
  list.innerHTML = '';
  msg.classList.remove('hidden');
  msg.textContent = '読み込み中…';
  try {
    const data = await api('/api/readings');
    state.readings = data.readings || [];
    renderReadings();
  } catch (err) {
    msg.textContent = err.message || '一覧を取得できませんでした';
  }
}

function renderReadings() {
  const q = normalize($('#searchInput').value);
  const filtered = state.readings.filter(r => {
    const p = r.person || {};
    const hay = normalize([p.name_ja, p.name_kana, p.roman_name, p.birth_date, r.reading_id].join(' '));
    return !q || hay.includes(q);
  });
  $('#recordCount').textContent = `${filtered.length}件`;
  const msg = $('#listMessage');
  const list = $('#recordList');
  list.innerHTML = '';
  if (!filtered.length) {
    msg.classList.remove('hidden');
    msg.textContent = state.readings.length ? '条件に合う記録がありません' : 'まだ鑑定記録がありません';
    return;
  }
  msg.classList.add('hidden');

  filtered.forEach(r => {
    const p = r.person || {};
    const card = document.createElement('article');
    card.className = 'record-card';
    card.innerHTML = `
      <div class="name"><strong>${escapeHtml(p.name_ja || p.roman_name || '名称未設定')}</strong><small>${escapeHtml(p.roman_name || p.name_kana || '')}</small></div>
      <div class="meta">${escapeHtml(p.birth_date || '生年月日なし')}</div>
      <div class="number-badge"><b>${r.shukumei_number ?? '–'}</b><small>宿命数</small></div>
      <div class="number-badge"><b>${r.unmei_number ?? '–'}</b><small>運命数</small></div>
      <div class="date">${escapeHtml(r.reading_date || '')}</div>
      <button class="detail-button">詳細</button>`;
    card.querySelector('.detail-button').addEventListener('click', () => openDetail(r));
    list.appendChild(card);
  });
}

function openDetail(r) {
  const p = r.person || {};
  const sections = (r.details || []).map(d => `
    <section class="detail-section">
      <h3>${escapeHtml(d.label || d.key)}</h3>
      <p>${escapeHtml(d.content || '')}</p>
    </section>`).join('');
  $('#detailContent').innerHTML = `
    <p class="eyebrow">${escapeHtml(r.reading_id || '')}</p>
    <h2>${escapeHtml(p.name_ja || p.roman_name || '名称未設定')}</h2>
    <p>${escapeHtml([p.roman_name, p.birth_date].filter(Boolean).join(' / '))}</p>
    <div class="detail-numbers">
      <div class="detail-number"><small>宿命数</small><strong>${r.shukumei_number ?? '–'}</strong></div>
      <div class="detail-number"><small>運命数</small><strong>${r.unmei_number ?? '–'}</strong></div>
    </div>
    ${r.name_calculation ? `<section class="detail-section"><h3>姓名計算メモ</h3><p>${escapeHtml(r.name_calculation)}</p></section>` : ''}
    ${sections}
    ${r.image_url ? `<p><a href="${escapeAttr(r.image_url)}" target="_blank" rel="noopener">原本画像をDriveで開く ↗</a></p>` : ''}`;
  $('#detailDialog').showModal();
}

function normalize(v) { return String(v || '').toLowerCase().replace(/[\s　]/g, ''); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#096;'); }

$$('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
$('#cameraInput').addEventListener('change', e => handleImage(e.target.files?.[0]));
$('#galleryInput').addEventListener('change', e => handleImage(e.target.files?.[0]));
$('#retryButton').addEventListener('click', resetCapture);
$('#newCaptureButton').addEventListener('click', resetCapture);
$('#openListButton').addEventListener('click', () => switchTab('list'));
$('#reviewForm').addEventListener('submit', registerReading);
$('#addOtherButton').addEventListener('click', () => addOtherRow());
$('#reloadListButton').addEventListener('click', loadReadings);
$('#searchInput').addEventListener('input', renderReadings);
$('#closeDialog').addEventListener('click', () => $('#detailDialog').close());
$('#detailDialog').addEventListener('click', e => { if (e.target === $('#detailDialog')) $('#detailDialog').close(); });

checkHealth();
