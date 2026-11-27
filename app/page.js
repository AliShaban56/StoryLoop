'use client';
import { createElement as h, useCallback, useEffect, useState } from 'react';

const api = async (url, opts) => {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

function Lamp({ lamp }) {
  return h('div', { className: 'lamp' },
    h('span', { className: `dot ${lamp.state}` }),
    h('div', null, h('b', null, lamp.label), h('small', null, lamp.detail)));
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    const r = await post('/api/login', { password: pw });
    if (r.ok) onDone(); else setErr('كلمة السر غلط (أو ADMIN_PASSWORD مش متظبطة على Vercel)');
  };
  return h('main', null,
    h('h1', null, 'StoryLoop'),
    h('div', { className: 'card' },
      h('input', { type: 'password', placeholder: 'كلمة سر اللوحة', value: pw, onChange: (e) => setPw(e.target.value), onKeyDown: (e) => e.key === 'Enter' && go() }),
      h('div', { className: 'row' }, h('button', { onClick: go }, 'دخول')),
      err && h('div', { className: 'msg' }, err)));
}

export default function Page() {
  const [authed, setAuthed] = useState(null);
  const [lamps, setLamps] = useState([]);
  const [keys, setKeys] = useState([]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await api('/api/status');
    if (s.status === 401) { setAuthed(false); return; }
    setAuthed(true);
    setLamps(s.lamps || []);
    const k = await api('/api/keys');
    setKeys(k.keys || []);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (authed === null) return h('main', null, 'جاري التحميل…');
  if (authed === false) return h(Login, { onDone: load });

  const addKeys = async () => {
    setBusy(true);
    const r = await post('/api/keys', { provider: 'agnes', keys: text });
    setMsg(`اتضاف ${r.added ?? 0} مفتاح${r.skipped ? ` (${r.skipped} مكرر اتجاهل)` : ''}`);
    setText('');
    setBusy(false);
    load();
  };
  const testAgnes = async () => {
    setBusy(true); setMsg('بيختبر الاتصال بـ Agnes…');
    const r = await post('/api/test-agnes');
    setMsg(r.ok ? `✅ Agnes شغّال، الرد: ${r.reply}` : `❌ ${r.error}`);
    setBusy(false);
    load();
  };
  const act = async (id, action) => { await api('/api/keys', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) }); load(); };
  const del = async (id) => { if (confirm('مسح المفتاح؟')) { await api(`/api/keys?id=${id}`, { method: 'DELETE' }); load(); } };

  const stateAr = { active: 'شغّال', cooling: 'مستني', disabled: 'موقوف' };

  return h('main', null,
    h('h1', null, 'StoryLoop'),
    h('div', { className: 'card' }, h('h2', null, 'حالة الربط'), lamps.map((l) => h(Lamp, { key: l.id, lamp: l }))),
    h('div', { className: 'card' },
      h('h2', null, 'إضافة مفاتيح Agnes (مفتاح في كل سطر)'),
      h('textarea', { value: text, onChange: (e) => setText(e.target.value), placeholder: 'sk-...\nsk-...' }),
      h('div', { className: 'row' },
        h('button', { onClick: addKeys, disabled: busy || !text.trim() }, 'إضافة'),
        h('button', { className: 'ghost', onClick: testAgnes, disabled: busy }, 'اختبار الاتصال')),
      msg && h('div', { className: 'msg' }, msg)),
    h('div', { className: 'card' },
      h('h2', null, `المفاتيح (${keys.length})`),
      keys.length === 0 ? h('div', { className: 'msg' }, 'لسه مفيش مفاتيح') :
        h('table', null,
          h('thead', null, h('tr', null, ['#', 'المفتاح', 'الحالة', 'استخدام', 'أخطاء', ''].map((t, i) => h('th', { key: i }, t)))),
          h('tbody', null, keys.map((k) => h('tr', { key: k.id },
            h('td', null, k.id),
            h('td', { className: 'mono' }, k.masked),
            h('td', null, h('span', { className: `dot ${k.status === 'active' ? 'ok' : k.status === 'disabled' ? 'error' : ''}`, style: { display: 'inline-block', marginLeft: 6, width: 10, height: 10 } }), stateAr[k.status] || k.status, k.last_error ? h('small', { style: { display: 'block', color: 'var(--mute)' } }, k.last_error.slice(0, 60)) : null),
            h('td', null, k.uses),
            h('td', null, k.fail_count),
            h('td', null,
              h('button', { className: 'ghost', onClick: () => act(k.id, k.status === 'disabled' ? 'enable' : 'disable') }, k.status === 'disabled' ? 'تفعيل' : 'إيقاف'),
              ' ', h('button', { className: 'ghost', onClick: () => del(k.id) }, 'مسح')))))))
  );
}
