// shared.js — общий код для Лепестка
const SB_URL = 'https://tfqsyovyshheqkslsjhx.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmcXN5b3Z5c2hoZXFrc2xzamh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MTU3MTMsImV4cCI6MjEwMzA5MTcxM30.S5-0MVJ6HLyFs2TQ5tpE7IlRXum25j7Vwhvnab1pAIY';
const ADMIN_EMAIL = 'artixz18@gmail.com';

let sb;
if (typeof supabase !== 'undefined') {
  sb = supabase.createClient(SB_URL, SB_KEY);
}

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function richText(t) { return String(t || '').split(/\n+/).map(p => esc(p)).join('<br>'); }

function whenRu(t) {
  try {
    return new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

function statusRu(s) {
  return ({
    new: '🆕 новый',
    accepted: '⏳ принят',
    ready: '✅ готов',
    delivered: '🚚 доставлен',
    cancelled: '❌ отменён'
  })[s] || s;
}

function statusCls(s) { return 's-' + s; }

function toast(m, duration = 2600) {
  const t = $('toast');
  if (!t) return;
  t.textContent = m;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), duration);
}

function closeSheet(id) {
  const el = $(id);
  if (el) el.classList.add('hidden');
}

function openSheet(id) {
  const el = $(id);
  if (el) el.classList.remove('hidden');
}

function track(name, extra = {}) {
  if (!sb) return;
  try {
    let device = localStorage.getItem('lep_device');
    if (!device) {
      device = 'd' + Math.random().toString(36).slice(2) + Date.now();
      localStorage.setItem('lep_device', device);
    }
    sb.from('events').insert({
      name,
      device,
      user_id: window.me ? window.me.id : null,
      ...extra
    }).then(() => {}).catch(() => {});
  } catch (e) {}
}

function handleSBError(error, context = '') {
  if (!error) return;
  const messages = {
    'duplicate key value': 'Уже существует',
    'violates foreign key': 'Связанная запись не найдена',
    'violates row-level security': 'Нет доступа',
    'null value in column': 'Заполните обязательные поля',
    'invalid input syntax': 'Неверный формат данных'
  };
  let msg = error.message || 'Неизвестная ошибка';
  for (const [key, val] of Object.entries(messages)) {
    if (msg.toLowerCase().includes(key)) {
      msg = val;
      break;
    }
  }
  toast(context ? context + ': ' + msg : msg);
}

window.Lep = {
  SB_URL, SB_KEY, ADMIN_EMAIL, sb,
  $, esc, richText, whenRu, statusRu, statusCls,
  toast, closeSheet, openSheet, track, handleSBError
};
