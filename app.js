/* SnapEx — reads, edits and strips photo metadata entirely in the browser.
   Libraries: exifr (reading), piexifjs (JPEG EXIF writing), Google Maps embed (map). */
(() => {
'use strict';
const $ = s => document.querySelector(s);

const OPTS = {tiff:true, ifd0:true, exif:true, gps:true, interop:true, ifd1:false, iptc:true, xmp:true, icc:true, jfif:true, ihdr:true,
  makerNote:false, userComment:true, mergeOutput:false, translateKeys:true, translateValues:true, reviveValues:true, sanitize:true};
const GROUPS = [
  ['ifd0','Image & camera','IFD0'], ['exif','Capture settings','EXIF'], ['gps','Location','GPS'],
  ['iptc','Captions & rights','IPTC'], ['xmp','Extended metadata','XMP'], ['icc','Color profile','ICC'],
  ['ifd1','Thumbnail info','IFD1'], ['jfif','JPEG header','JFIF'], ['ihdr','PNG header','IHDR'], ['interop','Interoperability','Interop']
];
const KIND_LABEL = {jpeg:'JPEG', png:'PNG', webp:'WebP', heic:'HEIC / HEIF', avif:'AVIF', tiff:'TIFF / RAW', gif:'GIF', other:'Unknown'};
const EXT = {jpeg:'jpg', png:'png', webp:'webp'};

let st = {};          // the photo currently shown
let original = null;  // the photo as first opened

/* ---------------- helpers ---------------- */
const toBin = u8 => { let s=''; for (let i=0;i<u8.length;i+=0x8000) s += String.fromCharCode.apply(null, u8.subarray(i,i+0x8000)); return s; };
const fromBin = s => { const u=new Uint8Array(s.length); for (let i=0;i<s.length;i++) u[i]=s.charCodeAt(i)&255; return u; };
const ascii = s => (s||'').replace(/[^\x20-\x7E]/g,'?');
const fmtBytes = n => n<1024 ? n+' B' : n<1048576 ? (n/1024).toFixed(1)+' KB' : (n/1048576).toFixed(2)+' MB';
const pad = n => String(n).padStart(2,'0');
const fmtDate = d => d instanceof Date && !isNaN(d) ? `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : String(d);
const round = (n,p=2) => Math.round(n*10**p)/10**p;
const baseName = n => n.replace(/\.[^.]+$/,'').replace(/-(edited|clean)$/,'');
let toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true, 3400); }
function setStatus(msg, warn){ const s=$('#status'); if (!msg){ s.hidden=true; return; } s.hidden=false; s.textContent=msg; s.classList.toggle('warn', !!warn); }

function download(filename, data, type){
  const blob = data instanceof Blob ? data : new Blob([data], {type: type || 'application/octet-stream'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function kindOf(u8){
  if (u8[0]===0xFF && u8[1]===0xD8) return 'jpeg';
  if (u8[0]===0x89 && u8[1]===0x50 && u8[2]===0x4E && u8[3]===0x47) return 'png';
  const a = String.fromCharCode(...u8.subarray(0,12));
  if (a.startsWith('RIFF') && a.slice(8,12)==='WEBP') return 'webp';
  if (a.slice(4,8)==='ftyp') return /avif/.test(String.fromCharCode(...u8.subarray(8,24))) ? 'avif' : 'heic';
  if (a.startsWith('II*\0') || a.startsWith('MM\0*') || a.startsWith('IIRO') || a.startsWith('IIU\0')) return 'tiff';
  if (a.startsWith('GIF8')) return 'gif';
  return 'other';
}

function fmtVal(v){
  if (v == null) return '';
  if (v instanceof Date) return fmtDate(v);
  if (ArrayBuffer.isView(v)) return v.length <= 16 ? Array.from(v).join(', ') : `${v.length} bytes of binary data`;
  if (Array.isArray(v)) return v.map(fmtVal).join(', ');
  if (typeof v === 'object') { try { return JSON.stringify(v, jsonReplacer, 1).replace(/\n\s*/g,' '); } catch { return String(v); } }
  if (typeof v === 'number') return String(round(v, 6));
  return String(v);
}
function jsonReplacer(k, v){
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return v.length<=16 ? Array.from(v) : `<${v.length} bytes>`;
  if (typeof v === 'string' && v.length>2000) return v.slice(0,2000)+'…';
  return v;
}
function toJsonText(){
  const clone = st.parsed ? JSON.parse(JSON.stringify(st.parsed, function(k,v){ const raw=this[k]; return raw instanceof Date ? fmtDate(raw) : jsonReplacer(k,v); })) : {};
  if (st.gps) clone.coordinates = {latitude: st.gps.latitude, longitude: st.gps.longitude};
  return JSON.stringify({file: st.name, format: KIND_LABEL[st.kind], size: st.size, metadata: clone}, null, 2);
}

/* ---------------- loading ---------------- */
function showWorkspace(){
  $('#landing').hidden = true; $('#workspace').hidden = false;
  window.scrollTo({top: 0});
}
async function loadBlob(blob, name, opts={}){
  if (typeof exifr === 'undefined') { toast('The metadata reader is still loading. Try again in a moment.'); return; }
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (st.url) URL.revokeObjectURL(st.url);
  if (st.thumbUrl) URL.revokeObjectURL(st.thumbUrl);
  st = {blob, name, kind: kindOf(u8), size: blob.size, u8, url: URL.createObjectURL(blob), sample: !!opts.sample, derived: opts.derived || null};
  if (!opts.derived) original = {blob, name, sample: !!opts.sample};
  try { st.parsed = await exifr.parse(buf.slice(0), OPTS); } catch { st.parsed = null; }
  try { st.gps = await exifr.gps(buf.slice(0)); } catch { st.gps = null; }
  if (st.gps && !(isFinite(st.gps.latitude) && isFinite(st.gps.longitude))) st.gps = null;
  try { st.thumb = await exifr.thumbnail(buf.slice(0)); } catch { st.thumb = null; }
  if (st.thumb && !st.thumb.length) st.thumb = null;
  st.dims = await imageDims(st.url);
  $('#editor').hidden = true;
  showWorkspace();
  render();
}
function imageDims(url){
  return new Promise(res => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res(null); im.src = url; });
}
async function openFile(f){
  if (!f) return;
  if (f.type && !f.type.startsWith('image/') && !/\.(heic|heif|tiff?|dng|cr2|cr3|nef|arw|orf|rw2)$/i.test(f.name)) { toast('That file is not an image. Choose a JPEG, PNG, WebP, HEIC, TIFF or RAW file.'); return; }
  setStatus(null);
  await loadBlob(f, f.name);
}

/* ---------------- render ---------------- */
function countTags(){
  const p = st.parsed; if (!p) return 0;
  return GROUPS.reduce((n,[k]) => n + (p[k] ? Object.keys(p[k]).length : 0), 0);
}

function render(){
  const p = st.parsed || {};
  const ifd0 = p.ifd0 || {}, ex = p.exif || {};

  const frame = $('#frame'); frame.textContent = '';
  if (st.dims) { const im = document.createElement('img'); im.src = st.url; im.alt = 'Preview of ' + st.name; frame.append(im); }
  else { const s = document.createElement('span'); s.className='noprev'; s.textContent = `Your browser can't preview ${KIND_LABEL[st.kind]} files, but the metadata was read in full.`; frame.append(s); }
  $('#fname').textContent = st.name;
  const tag = $('#ftag');
  tag.hidden = !(st.sample || st.derived);
  tag.textContent = st.derived ? (st.derived==='edited' ? 'Edited' : 'Cleaned') : 'Sample';

  const w = st.dims?.[0] || ex.ExifImageWidth || ifd0.ImageWidth || p.ihdr?.ImageWidth;
  const h = st.dims?.[1] || ex.ExifImageHeight || ifd0.ImageHeight || p.ihdr?.ImageHeight;
  const facts = [['Format', KIND_LABEL[st.kind]], ['File size', fmtBytes(st.size)],
    ['Dimensions', w&&h ? `${w} × ${h} px` : '—'], ['Resolution', w&&h ? round(w*h/1e6,1)+' MP' : '—'],
    ['Tags found', String(countTags())]];
  const dl = $('#facts'); dl.textContent='';
  for (const [k,v] of facts){ const dt=document.createElement('dt'); dt.textContent=k; const dd=document.createElement('dd'); dd.textContent=v; dl.append(dt,dd); }

  const t = ex.ExposureTime;
  $('#r_shutter').textContent = t ? (t>=1 ? `${round(t,1)} s` : `1/${Math.round(1/t)}`) : '—';
  $('#r_aperture').textContent = ex.FNumber ? `f/${round(ex.FNumber,1)}` : '—';
  const iso = ex.ISO ?? ex.ISOSpeedRatings ?? ex.PhotographicSensitivity;
  $('#r_iso').textContent = iso ? (Array.isArray(iso)?iso[0]:iso) : '—';
  const fl = ex.FocalLength, fl35 = ex.FocalLengthIn35mmFormat;
  $('#r_focal').textContent = fl ? `${round(fl,1)} mm` : '—';
  $('#r_focal').title = fl35 ? `${fl35} mm in 35 mm terms` : '';
  const make = (ifd0.Make||'').trim(), model = (ifd0.Model||'').trim();
  $('#r_camera').textContent = make||model ? (model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim()) : '—';
  $('#r_lens').textContent = ex.LensModel || ex.LensMake || '—';
  const taken = ex.DateTimeOriginal || ex.CreateDate || ifd0.ModifyDate;
  $('#r_date').textContent = taken ? fmtDate(taken) : '—';
  $('#lcd').classList.toggle('empty', !t && !ex.FNumber && !iso && !fl);

  const canEdit = st.kind === 'jpeg' && typeof piexif !== 'undefined';
  $('#editBtn').disabled = !canEdit;
  const stripOK = ['jpeg','png','webp'].includes(st.kind) || (!!st.dims && st.kind!=='heic');
  $('#stripBtn').disabled = !stripOK || countTags()===0;
  $('#keepIccRow').hidden = !['jpeg','png'].includes(st.kind) || !p.icc;
  const note = $('#editNote');
  if (!canEdit) { note.hidden=false; note.textContent = stripOK ? `Editing works on JPEG files. You can still remove all metadata from this ${KIND_LABEL[st.kind]}.` : `Editing and removing work on JPEG, PNG and WebP. This ${KIND_LABEL[st.kind]} file can be inspected only.`; }
  else note.hidden = true;
  $('#saveBtn').hidden = !st.derived;
  $('#revertBtn').hidden = !st.derived;

  renderRisks(p);
  renderMap();
  renderThumb();
  renderGroups();
}

/* ---------------- privacy check ---------------- */
function renderRisks(p){
  const ifd0 = p.ifd0||{}, ex = p.exif||{}, iptc = p.iptc||{}, xmp = p.xmp||{};
  const items = [];
  const add = (level, title, detail) => items.push({level, title, detail});
  if (st.gps) add('high', 'GPS location', `Points to ${round(st.gps.latitude,5)}, ${round(st.gps.longitude,5)}. Anyone with the file can see where it was taken.`);
  const serial = ex.BodySerialNumber || ex.SerialNumber || ifd0.SerialNumber;
  if (serial) add('medium', 'Camera serial number', `"${serial}" links this photo to every other photo from the same camera.`);
  if (ex.LensSerialNumber) add('medium', 'Lens serial number', `"${ex.LensSerialNumber}" identifies your specific lens.`);
  const owner = ex.CameraOwnerName || ifd0.Artist || iptc.Byline || (Array.isArray(xmp.creator) ? xmp.creator.join(', ') : xmp.creator);
  if (owner) add('medium', 'Name of owner or artist', `"${fmtVal(owner)}" is stored in the file.`);
  const taken = ex.DateTimeOriginal || ex.CreateDate;
  if (taken) add('medium', 'Exact date and time', `${fmtDate(taken)}. Together with location, this shows where you were and when.`);
  if (ex.ImageUniqueID) add('medium', 'Unique image ID', 'A fixed ID that can match copies of this photo across sites.');
  if (st.thumb) add('medium', 'Embedded thumbnail', 'A small preview inside the file. After cropping or editing it can still show the original picture.');
  const make = ifd0.Make || ifd0.Model;
  if (make) add('low', 'Camera make and model', `${[ifd0.Make, ifd0.Model].filter(Boolean).join(' ')}.`);
  if (ex.LensModel) add('low', 'Lens model', ex.LensModel + '.');
  if (ifd0.Software) add('low', 'Software', `${ifd0.Software} was used to make or edit the file.`);

  const ul = $('#risks'); ul.textContent = '';
  const score = $('#riskScore');
  const worst = items.find(i=>i.level==='high') ? 'high' : items.find(i=>i.level==='medium') ? 'medium' : items.length ? 'low' : 'none';
  score.className = 'risk-score lvl ' + worst;
  score.style.padding = '5px 10px';
  score.textContent = {high:'High risk', medium:'Medium risk', low:'Low risk', none:'Nothing personal found'}[worst];
  if (!items.length) {
    const li = document.createElement('li'); li.innerHTML = '<span class="lvl none">Clear</span><span>No location, serial numbers, names or timestamps were found. This photo is safe to share as it is.</span>';
    ul.append(li); return;
  }
  for (const it of items){
    const li = document.createElement('li');
    const l = document.createElement('span'); l.className = 'lvl ' + it.level; l.textContent = it.level;
    const b = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = it.title;
    const sm = document.createElement('small'); sm.textContent = it.detail; b.append(strong, sm);
    li.append(l, b); ul.append(li);
  }
}

/* ---------------- map (Google Maps embed, no API key) ---------------- */
let mapType = 'm';
function drawMap(){
  if (!st.gps) return;
  const {latitude: lat, longitude: lon} = st.gps;
  const box = $('#map'); box.textContent = '';
  const f = document.createElement('iframe');
  f.title = 'Google Map showing where the photo was taken';
  f.loading = 'lazy'; f.referrerPolicy = 'no-referrer';
  f.src = `https://maps.google.com/maps?q=${lat},${lon}&z=15&t=${mapType}&hl=en&output=embed`;
  box.append(f);
  document.querySelectorAll('[data-maptype]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.maptype === mapType)));
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-maptype]'); if (!b) return;
  mapType = b.dataset.maptype; drawMap();
});
function renderMap(){
  const panel = $('#mapPanel');
  if (!st.gps) { panel.hidden = true; $('#map').textContent = ''; return; }
  panel.hidden = false;
  const {latitude: lat, longitude: lon} = st.gps;
  const alt = st.parsed?.gps?.GPSAltitude;
  const c = $('#coords'); c.textContent = '';
  for (const s of [`Lat ${round(lat,6)}`, `Lon ${round(lon,6)}`, alt!=null ? `Altitude ${round(alt,1)} m` : null].filter(Boolean)){ const e=document.createElement('span'); e.textContent=s; c.append(e); }
  $('#gmapsLink').href = `https://www.google.com/maps?q=${lat},${lon}`;
  drawMap();
}

/* ---------------- thumbnail ---------------- */
function renderThumb(){
  const panel = $('#thumbPanel');
  const jpeg = st.kind === 'jpeg' && typeof piexif !== 'undefined';
  if (!st.thumb && !jpeg) { panel.hidden = true; return; }
  panel.hidden = false;
  const box = $('#thumbBox'); box.textContent = '';
  if (st.thumb){
    st.thumbUrl = URL.createObjectURL(new Blob([st.thumb], {type:'image/jpeg'}));
    const im = document.createElement('img'); im.src = st.thumbUrl; im.alt = 'Embedded thumbnail';
    box.append(im);
    im.onload = () => { $('#thumbNote').textContent = `${im.naturalWidth} × ${im.naturalHeight} px, ${fmtBytes(st.thumb.length)}. Cameras and phones store this small preview for fast browsing. Check that it matches the photo before you share.`; };
    $('#thumbNote').textContent = `${fmtBytes(st.thumb.length)} preview stored inside the file.`;
  } else {
    const s = document.createElement('span'); s.className='noprev'; s.textContent='None'; box.append(s);
    $('#thumbNote').textContent = 'This photo has no embedded thumbnail. You can add one built from the photo.';
  }
  $('#thumbSave').disabled = !st.thumb;
  $('#thumbRemove').disabled = !st.thumb || !jpeg;
  $('#thumbRegen').hidden = !jpeg;
  $('#thumbRegen').textContent = st.thumb ? 'Rebuild from photo' : 'Add thumbnail';
}

/* ---------------- tag groups ---------------- */
function renderGroups(){
  const host = $('#groups'); host.textContent='';
  const p = st.parsed;
  const q = $('#filter').value.trim().toLowerCase();
  let shown = 0, total = 0;
  if (!p || countTags()===0){
    const d=document.createElement('div'); d.className='blank';
    d.innerHTML = '<strong>No metadata in this file</strong>It carries no EXIF, GPS, IPTC, XMP or color-profile tags. Screenshots and images saved from social apps usually look like this.';
    host.append(d); $('#count').textContent=''; return;
  }
  const keys = [...GROUPS.map(g=>g[0]), ...Object.keys(p).filter(k => !GROUPS.some(g=>g[0]===k) && p[k] && typeof p[k]==='object')];
  for (const key of keys){
    const data = p[key]; if (!data || typeof data!=='object') continue;
    const meta = GROUPS.find(g=>g[0]===key) || [key, key.toUpperCase(), key];
    const rows = [];
    for (const [k,v] of Object.entries(data)){
      const label = /^\d+$/.test(k) ? `Tag 0x${(+k).toString(16).padStart(4,'0')}` : k.replace(/([a-z])([A-Z])/g,'$1 $2');
      const val = fmtVal(v);
      total++;
      if (q && !(label.toLowerCase().includes(q) || k.toLowerCase().includes(q) || val.toLowerCase().includes(q) || meta[1].toLowerCase().includes(q))) continue;
      rows.push([label, val]);
    }
    if (!rows.length) continue;
    shown += rows.length;
    const det = document.createElement('details'); det.className='group';
    det.open = !!q || !['xmp','icc','interop','jfif','ifd1'].includes(key);
    const sum = document.createElement('summary');
    sum.innerHTML = '<h3></h3><span class="src"></span><span class="n"></span>';
    sum.querySelector('h3').textContent = meta[1]; sum.querySelector('.src').textContent = meta[2];
    sum.querySelector('.n').textContent = rows.length + (rows.length===1?' tag':' tags');
    const wrap = document.createElement('div'); wrap.className='tbl';
    const tb = document.createElement('table'); const body = document.createElement('tbody');
    for (const [k,v] of rows){
      const tr=document.createElement('tr');
      const a=document.createElement('td'); a.className='k'; a.textContent=k;
      const b=document.createElement('td'); b.className='v'; b.textContent=v;
      tr.append(a,b); body.append(tr);
    }
    tb.append(body); wrap.append(tb); det.append(sum, wrap); host.append(det);
  }
  $('#count').textContent = q ? `${shown} of ${total}` : `${total} tags`;
  if (!shown){ const d=document.createElement('div'); d.className='blank'; d.innerHTML='<strong>No tags match</strong>Try a shorter word, such as "date" or "lens".'; host.append(d); }
}

/* ---------------- JPEG EXIF rewriting ---------------- */
const I = () => piexif.ImageIFD, E = () => piexif.ExifIFD;
async function rewriteExif(mutate, label, statusMsg){
  const bin = toBin(st.u8);
  let obj; try { obj = piexif.load(bin); } catch { obj = {}; }
  for (const k of ['0th','Exif','GPS','Interop','1st']) obj[k] = obj[k] || {};
  mutate(obj);
  delete obj['0th'][I().ExifTag]; delete obj['0th'][I().GPSTag]; delete obj['Exif'][E().InteroperabilityTag];
  if (!obj.thumbnail) { obj.thumbnail = null; obj['1st'] = {}; }
  let dump;
  try { dump = piexif.dump(obj); }
  catch {
    try { delete obj['Exif'][E().MakerNote]; obj['Interop'] = {}; dump = piexif.dump(obj); }
    catch { setStatus('This file has metadata the editor cannot rewrite. Use "Remove metadata" instead.', true); return false; }
  }
  const out = fromBin(piexif.insert(dump, bin));
  await loadBlob(new Blob([out], {type:'image/jpeg'}), baseName(st.name) + '-edited.jpg', {derived: label});
  setStatus(statusMsg);
  return true;
}

function openEditor(){
  let obj; try { obj = piexif.load(toBin(st.u8)); } catch { obj = {'0th':{},'Exif':{},'GPS':{}}; }
  const z = obj['0th']||{}, ex = obj['Exif']||{};
  const g = (o,t) => typeof o[t]==='string' ? o[t].replace(/\0+$/,'') : '';
  $('#e_make').value = g(z, I().Make); $('#e_model').value = g(z, I().Model);
  $('#e_lens').value = g(ex, E().LensModel); $('#e_date').value = g(ex, E().DateTimeOriginal);
  $('#e_artist').value = g(z, I().Artist); $('#e_copy').value = g(z, I().Copyright);
  $('#e_desc').value = g(z, I().ImageDescription); $('#e_soft').value = g(z, I().Software);
  $('#e_nogps').checked = false; $('#e_nogps').disabled = !obj.GPS || !Object.keys(obj.GPS).length;
  $('#e_noserial').checked = false; $('#e_noserial').disabled = !(ex[E().BodySerialNumber] || ex[E().LensSerialNumber]);
  $('#editor').hidden = false; $('#e_make').focus();
}
async function applyEdits(ev){
  ev.preventDefault();
  const dateEl = $('#e_date');
  if (!dateEl.checkValidity()){ dateEl.focus(); toast('Date taken must look like 2026:03:14 06:42:10, or be left empty.'); return; }
  await rewriteExif(obj => {
    const set = (o, t, v) => { v = ascii(v.trim()); if (v) o[t] = v; else delete o[t]; };
    set(obj['0th'], I().Make, $('#e_make').value); set(obj['0th'], I().Model, $('#e_model').value);
    set(obj['Exif'], E().LensModel, $('#e_lens').value);
    set(obj['Exif'], E().DateTimeOriginal, dateEl.value);
    if (dateEl.value.trim()) obj['Exif'][E().DateTimeDigitized] = dateEl.value.trim();
    set(obj['0th'], I().Artist, $('#e_artist').value); set(obj['0th'], I().Copyright, $('#e_copy').value);
    set(obj['0th'], I().ImageDescription, $('#e_desc').value); set(obj['0th'], I().Software, $('#e_soft').value);
    if ($('#e_nogps').checked) obj['GPS'] = {};
    if ($('#e_noserial').checked){ delete obj['Exif'][E().BodySerialNumber]; delete obj['Exif'][E().LensSerialNumber]; }
  }, 'edited', 'Changes applied to a copy. Download it to keep it.');
}

async function makeThumbBin(){
  const im = new Image(); im.src = st.url; await im.decode();
  const s = Math.min(1, 160 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth*s)); c.height = Math.max(1, Math.round(im.naturalHeight*s));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  return toBin(new Uint8Array(await b.arrayBuffer()));
}
const THUMB_IFD = () => ({[I().Compression]:6, [I().XResolution]:[72,1], [I().YResolution]:[72,1], [I().ResolutionUnit]:2});

/* ---------------- stripping ---------------- */
function concat(parts){ const n=parts.reduce((a,p)=>a+p.length,0); const o=new Uint8Array(n); let i=0; for(const p of parts){o.set(p,i);i+=p.length;} return o; }
function stripJpeg(u8, keepIcc){
  const out=[u8.subarray(0,2)]; let i=2;
  while (i < u8.length){
    if (u8[i]!==0xFF){ out.push(u8.subarray(i)); break; }
    const m=u8[i+1];
    if (m===0xFF){ i++; continue; }
    if (m===0xDA){ out.push(u8.subarray(i)); break; }
    if (m===0x01 || (m>=0xD0 && m<=0xD7)){ out.push(u8.subarray(i,i+2)); i+=2; continue; }
    const len=(u8[i+2]<<8)|u8[i+3];
    // keep APP0 (JFIF), APP14 (Adobe color transform) and, if asked, APP2 (ICC profile)
    const keep = m===0xE0 || m===0xEE || (m===0xE2 && keepIcc) || m<0xE0 || (m>0xEF && m!==0xFE);
    if (keep) out.push(u8.subarray(i, i+2+len));
    i += 2+len;
  }
  return concat(out);
}
function stripPng(u8, keepIcc){
  const keep = new Set(['PLTE','tRNS','gAMA','cHRM','sRGB','sBIT','bKGD','pHYs','acTL','fcTL','fdAT','hIST','sPLT']);
  if (keepIcc) keep.add('iCCP');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out=[u8.subarray(0,8)]; let i=8;
  while (i+12 <= u8.length){
    const len = dv.getUint32(i); const type = String.fromCharCode(u8[i+4],u8[i+5],u8[i+6],u8[i+7]);
    if ((type[0] >= 'A' && type[0] <= 'Z') || keep.has(type)) out.push(u8.subarray(i, i+12+len));
    i += 12+len; if (type==='IEND') break;
  }
  return concat(out);
}
async function reencode(type){
  const im = new Image(); im.src = st.url; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im,0,0);
  return await new Promise(r => c.toBlob(r, type, 0.95));
}
async function strip(){
  const before = st.size, keepIcc = $('#keepIcc').checked && !$('#keepIccRow').hidden;
  let blob, ext = EXT[st.kind] || 'png', note = '';
  try {
    if (st.kind==='jpeg'){
      let out = stripJpeg(st.u8, keepIcc);
      let rawO = 1; try { rawO = piexif.load(toBin(st.u8))['0th'][piexif.ImageIFD.Orientation] || 1; } catch {}
      if (rawO > 1){ out = fromBin(piexif.insert(piexif.dump({'0th':{[piexif.ImageIFD.Orientation]: rawO}}), toBin(out))); note = ' Only the rotation flag was kept, so the photo still displays upright.'; }
      blob = new Blob([out], {type:'image/jpeg'});
    } else if (st.kind==='png'){
      blob = new Blob([stripPng(st.u8, keepIcc)], {type:'image/png'});
    } else if (st.kind==='webp'){
      blob = await reencode('image/webp'); note = ' WebP files are re-encoded at high quality to clear their metadata.';
    } else {
      blob = await reencode('image/png'); ext='png'; note = ' Saved as PNG, because this format cannot be rewritten in the browser.';
    }
  } catch { setStatus('This file could not be cleaned. It may be damaged or use an unsupported variant.', true); return; }
  await loadBlob(blob, `${baseName(st.name)}-clean.${ext}`, {derived:'clean'});
  const saved = before - blob.size;
  setStatus(`Metadata removed${saved>0 ? `, ${fmtBytes(saved)} smaller` : ''}.${keepIcc ? ' The color profile was kept.' : ''}${note} Download the copy to keep it.`);
}

/* ---------------- sample photo ---------------- */
async function makeSample(){
  if (typeof piexif === 'undefined') { toast('Still loading. Try again in a moment.'); return; }
  const c = document.createElement('canvas'); c.width=1200; c.height=800; const x = c.getContext('2d');
  const sky = x.createLinearGradient(0,0,0,520); sky.addColorStop(0,'#3d5f86'); sky.addColorStop(.55,'#e7a77a'); sky.addColorStop(1,'#f6d7a8');
  x.fillStyle=sky; x.fillRect(0,0,1200,800);
  x.fillStyle='#fff3d6'; x.beginPath(); x.arc(820,430,46,0,7); x.fill();
  for (const [col,base,f,a] of [['#6f7f86',430,.006,38],['#4f6a5e',500,.009,30],['#2f5040',580,.012,26],['#1f3a2c',670,.004,40]]){
    x.fillStyle=col; x.beginPath(); x.moveTo(0,800);
    for (let i=0;i<=1200;i+=10) x.lineTo(i, base + Math.sin(i*f + base)*a + Math.sin(i*f*3.1)*a*.35);
    x.lineTo(1200,800); x.fill();
  }
  x.strokeStyle='#ffffff18'; x.lineWidth=2;
  for (let r=0;r<9;r++){ x.beginPath(); for (let i=0;i<=1200;i+=12) x.lineTo(i, 690 + r*13 + Math.sin(i*.02 + r)*4); x.stroke(); }
  const jpg = await new Promise(r => c.toBlob(r,'image/jpeg',0.9));
  const t = document.createElement('canvas'); t.width=160; t.height=107; t.getContext('2d').drawImage(c,0,0,160,107);
  const tj = await new Promise(r => t.toBlob(r,'image/jpeg',0.8));
  const bin = toBin(new Uint8Array(await jpg.arrayBuffer()));
  const I0 = piexif.ImageIFD, EX = piexif.ExifIFD, G = piexif.GPSIFD;
  const exif = {
    '0th': {[I0.Make]:'FUJIFILM', [I0.Model]:'X-T5', [I0.Orientation]:1, [I0.XResolution]:[72,1], [I0.YResolution]:[72,1], [I0.ResolutionUnit]:2,
            [I0.Software]:'SnapEx sample', [I0.Artist]:'Sample Photographer', [I0.Copyright]:'(c) 2026 Sample Photographer', [I0.ImageDescription]:'Sunrise over tea estates'},
    'Exif': {[EX.ExposureTime]:[1,250], [EX.FNumber]:[28,10], [EX.ExposureProgram]:3, [EX.ISOSpeedRatings]:160,
             [EX.DateTimeOriginal]:'2026:03:14 06:42:10', [EX.DateTimeDigitized]:'2026:03:14 06:42:10',
             [EX.ExposureBiasValue]:[-1,3], [EX.MeteringMode]:5, [EX.Flash]:16, [EX.FocalLength]:[23,1], [EX.FocalLengthIn35mmFilm]:35,
             [EX.ColorSpace]:1, [EX.PixelXDimension]:1200, [EX.PixelYDimension]:800, [EX.WhiteBalance]:0,
             [EX.LensMake]:'FUJIFILM', [EX.LensModel]:'XF23mmF1.4 R LM WR', [EX.BodySerialNumber]:'5CA01234'},
    'GPS': {[G.GPSVersionID]:[2,2,0,0], [G.GPSLatitudeRef]:'N', [G.GPSLatitude]:[[10,1],[5,1],[2004,100]],
            [G.GPSLongitudeRef]:'E', [G.GPSLongitude]:[[77,1],[3,1],[3420,100]], [G.GPSAltitudeRef]:0, [G.GPSAltitude]:[1600,1],
            [G.GPSDateStamp]:'2026:03:14'},
    '1st': {[I0.Compression]:6, [I0.XResolution]:[72,1], [I0.YResolution]:[72,1], [I0.ResolutionUnit]:2},
    'thumbnail': toBin(new Uint8Array(await tj.arrayBuffer()))
  };
  const out = fromBin(piexif.insert(piexif.dump(exif), bin));
  setStatus(null);
  await loadBlob(new Blob([out],{type:'image/jpeg'}), 'tea-estate-sunrise.jpg', {sample:true});
  setStatus('This is a sample photo with made-up camera and GPS data. Open your own photo to inspect it.', true);
}

/* ---------------- wiring ---------------- */
const pick = () => $('#fileInput').click();
function selectTab(url){
  $('#tabFile').setAttribute('aria-selected', String(!url)); $('#tabUrl').setAttribute('aria-selected', String(url));
  $('#paneFile').hidden = url; $('#paneUrl').hidden = !url;
  if (url) $('#urlInput').focus();
}
$('#tabFile').onclick = () => selectTab(false);
$('#tabUrl').onclick = () => selectTab(true);
$('#drop').onclick = pick;
$('#drop').onkeydown = e => { if (e.key==='Enter' || e.key===' ') { e.preventDefault(); pick(); } };
$('#newBtn').onclick = pick;
$('#sampleBtn').onclick = makeSample;
$('#fileInput').onchange = e => { openFile(e.target.files[0]); e.target.value=''; };
$('#filter').oninput = renderGroups;
$('#editBtn').onclick = openEditor;
$('#cancelEdit').onclick = () => { $('#editor').hidden = true; };
$('#editor').onsubmit = applyEdits;
$('#stripBtn').onclick = strip;
$('#revertBtn').onclick = async () => { if (original){ await loadBlob(original.blob, original.name, {sample: original.sample}); setStatus(null); } };
$('#saveBtn').onclick = () => download(st.name, st.blob);
$('#saveJson').onclick = () => download(baseName(st.name) + '-metadata.json', toJsonText(), 'application/json');
$('#copyJson').onclick = () => {
  const txt = toJsonText();
  try { navigator.clipboard.writeText(txt).then(() => toast('Metadata copied as JSON'), () => toast('Copying was blocked. Use Download JSON instead.')); }
  catch { toast('Copying was blocked. Use Download JSON instead.'); }
};
$('#thumbSave').onclick = () => { if (st.thumb) download(baseName(st.name) + '-thumbnail.jpg', new Blob([st.thumb], {type:'image/jpeg'})); };
$('#thumbRemove').onclick = () => rewriteExif(obj => { obj.thumbnail = null; obj['1st'] = {}; }, 'edited', 'Thumbnail removed from a copy. Download it to keep it.');
$('#thumbRegen').onclick = async () => {
  let tb; try { tb = await makeThumbBin(); } catch { setStatus('The thumbnail could not be built from this photo.', true); return; }
  await rewriteExif(obj => { obj.thumbnail = tb; obj['1st'] = THUMB_IFD(); }, 'edited', 'Thumbnail rebuilt from the photo. Download the copy to keep it.');
};
$('#urlForm').onsubmit = async e => {
  e.preventDefault();
  const u = $('#urlInput').value.trim();
  if (!/^https?:\/\//i.test(u)) { toast('Enter a full image address starting with http:// or https://'); return; }
  const btn = e.submitter || $('#urlForm button'); btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const r = await fetch(u, {mode: 'cors'});
    if (!r.ok) throw new Error(String(r.status));
    const blob = await r.blob();
    const name = decodeURIComponent(new URL(u).pathname.split('/').pop() || '') || 'image';
    setStatus(null); await loadBlob(blob, name);
  } catch { toast("That site doesn't let other pages read its images. Save the image, then use Upload file."); }
  finally { btn.disabled = false; btn.textContent = 'Load image'; }
};

const dropEl = $('#drop');
let dragDepth = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types||[])].includes('Files')){ dragDepth++; if ($('#landing').hidden) $('#overlay').hidden=false; else dropEl.classList.add('drag'); e.preventDefault(); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('dragleave', () => { if (--dragDepth<=0){ dragDepth=0; $('#overlay').hidden=true; dropEl.classList.remove('drag'); } });
addEventListener('drop', e => { e.preventDefault(); dragDepth=0; $('#overlay').hidden=true; dropEl.classList.remove('drag'); const f = e.dataTransfer?.files?.[0]; if (f) openFile(f); });
addEventListener('paste', e => { const f = [...(e.clipboardData?.files||[])].find(f => f.type.startsWith('image/')); if (f){ e.preventDefault(); openFile(f); } });
})();
