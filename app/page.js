'use client';
import { createElement as h, useCallback, useEffect, useState } from 'react';

const api = async (url, options) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ...data };
};
const post = (url, body) => api(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

function Lamp({ lamp }) {
  return h('div', { className: 'lamp' },
    h('span', { className: 'dot ' + lamp.state }),
    h('div', null, h('b', null, lamp.label), h('small', null, lamp.detail)));
}

function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const go = async () => {
    const result = await post('/api/login', { password });
    if (result.ok) onDone();
    else setError('كلمة السر غلط أو ADMIN_PASSWORD غير مضبوط في إعدادات النشر');
  };
  return h('main', null,
    h('h1', null, 'StoryLoop'),
    h('div', { className: 'card' },
      h('input', {
        type: 'password',
        placeholder: 'كلمة سر اللوحة',
        value: password,
        onChange: (event) => setPassword(event.target.value),
        onKeyDown: (event) => event.key === 'Enter' && go(),
      }),
      h('div', { className: 'row' }, h('button', { onClick: go }, 'دخول')),
      error && h('div', { className: 'msg error-msg' }, error)));
}

const stageNames = {
  story: 'كتابة القصة JSON',
  images: 'توليد صور المشاهد',
  motion: 'تحريك المشاهد بالتوازي',
  ready_for_assembly: 'المشاهد اكتملت — جاهزة للتجميع',
  completed: 'اكتمل الفيديو النهائي',
  failed: 'تعذر إكمال المهمة',
};
const roleLabel = (key) => key.index === 1 ? 'كتابة القصة + توليد الصور' : 'تحريك المشاهد بالتوازي';

export default function Page() {
  const [authed, setAuthed] = useState(null);
  const [lamps, setLamps] = useState([]);
  const [keys, setKeys] = useState([]);
  const [keyInputs, setKeyInputs] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);
  const [job, setJob] = useState(null);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const status = await api('/api/status');
    if (status.status === 401) {
      setAuthed(false);
      return;
    }
    setAuthed(true);
    setLamps(status.lamps || []);
    const keyInfo = await api('/api/keys');
    if (keyInfo.keys) setKeys(keyInfo.keys);
    else setMessage(keyInfo.error || 'تعذر قراءة المفاتيح من قاعدة البيانات');
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!job || ['completed', 'failed'].includes(job.status)) return undefined;
    let stopped = false;
    const poll = async () => {
      const current = await api('/api/jobs/' + job.id);
      if (stopped || !current.job) return;
      setJob(current.job);
      if (!['completed', 'ready_for_assembly', 'failed'].includes(current.job.status)) {
        await post('/api/jobs/tick', { jobId: job.id });
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  const saveKey = async (index) => {
    const value = String(keyInputs[index] || '').trim();
    if (!value) {
      setMessage('الصق مفتاح Agnes أولًا ثم اضغط حفظ.');
      return;
    }
    setSavingKey(index);
    setMessage('جارٍ تشفير وحفظ مفتاح Agnes رقم ' + index + ' في Turso…');
    try {
      const result = await post('/api/keys', { index, key: value });
      if (!result.ok) throw new Error(result.error || 'تعذر حفظ المفتاح');
      setKeyInputs((current) => ({ ...current, [index]: '' }));
      setMessage('✅ تم حفظ مفتاح Agnes رقم ' + index + ' مشفّرًا في قاعدة البيانات.');
      await load();
    } catch (error) {
      setMessage('❌ ' + error.message);
    } finally {
      setSavingKey(null);
    }
  };

  const deleteKey = async (index) => {
    if (!window.confirm('هل تريد حذف مفتاح Agnes رقم ' + index + ' من قاعدة البيانات؟')) return;
    setDeletingKey(index);
    try {
      const result = await api('/api/keys?index=' + index, { method: 'DELETE' });
      if (!result.ok) throw new Error(result.error || 'تعذر حذف المفتاح');
      setMessage('تم حذف مفتاح Agnes رقم ' + index + ' من قاعدة البيانات.');
      await load();
    } catch (error) {
      setMessage('❌ ' + error.message);
    } finally {
      setDeletingKey(null);
    }
  };

  const testAgnes = async () => {
    setTesting(true);
    setMessage('جارٍ اختبار مفتاح Agnes رقم 1 المحفوظ…');
    try {
      const result = await post('/api/test-agnes');
      setMessage(result.ok ? '✅ مفتاح النص يعمل: ' + result.reply : '❌ تعذر الاتصال: ' + result.error);
    } catch (error) {
      setMessage('❌ ' + error.message);
    } finally {
      setTesting(false);
      load();
    }
  };

  if (authed === null) return h('main', null, 'جاري التحميل…');
  if (authed === false) return h(Login, { onDone: load });

  const currentStage = job ? stageNames[job.stage] || job.stage : '';
  const sceneRows = job?.scenes || [];
  const doneImages = sceneRows.filter((scene) => scene.imageStatus === 'done').length;
  const doneClips = sceneRows.filter((scene) => scene.motionStatus === 'done').length;
  const configuredCount = keys.filter((key) => key.configured).length;
  const motionCount = keys.filter((key) => key.index > 1 && key.configured).length;

  return h('main', null,
    h('header', { className: 'topbar' },
      h('div', null,
        h('h1', null, 'StoryLoop'),
        h('p', null, 'منصة إنتاج القصص والمشاهد آليًا')),
      h('span', { className: 'pill' }, 'إدارة المنصة')),
    h('div', { className: 'card' },
      h('h2', null, 'حالة الأنظمة'),
      lamps.map((lamp) => h(Lamp, { key: lamp.id, lamp }))),
    h('section', { className: 'card key-linking' },
      h('div', { className: 'section-heading' },
        h('div', null,
          h('h2', null, 'ربط مفاتيح Agnes'),
          h('p', null, 'الصق كل مفتاح في خانته واضغط حفظ. المنصة تخزّنه مشفّرًا في Turso وتستخدمه مباشرة.')),
        h('span', { className: 'pill' }, configuredCount + ' / ' + keys.length + ' محفوظ')),
      h('div', { className: 'key-summary' },
        h('div', { className: 'key-role-card' },
          h('b', null, 'المفتاح رقم 1'),
          h('strong', null, 'النص + الصور'),
          h('small', null, keys.find((key) => key.index === 1)?.configured ? 'جاهز للاستخدام' : 'أضف المفتاح واحفظه')),
        h('div', { className: 'key-role-card' },
          h('b', null, 'المفاتيح 2–10'),
          h('strong', null, 'التحريك المتوازي'),
          h('small', null, motionCount + ' مفاتيح محفوظة للتحريك'))),
      h('div', { className: 'key-table-wrap' },
        h('table', { className: 'key-table' },
          h('thead', null,
            h('tr', null,
              ['الخانة', 'الاستخدام', 'الحالة', 'مفتاح API', 'الإجراء'].map((label, index) => h('th', { key: index }, label)))),
          h('tbody', null, keys.map((key) => h('tr', { key: key.index },
            h('td', { className: 'mono key-slot' }, 'AGNES #' + key.index),
            h('td', null, roleLabel(key)),
            h('td', null,
              h('span', { className: 'key-state ' + (key.configured ? 'is-configured' : 'is-missing') },
                key.configured ? (key.source === 'database' ? 'محفوظ' : 'من بيئة النشر') : 'فارغ'),
              key.configured && key.masked ? h('small', { className: 'masked-key' }, key.masked) : null),
            h('td', null,
              h('input', {
                className: 'key-input',
                type: 'password',
                dir: 'ltr',
                autoComplete: 'new-password',
                spellCheck: false,
                placeholder: key.configured ? 'أدخل قيمة جديدة للاستبدال' : 'الصق مفتاح Agnes هنا',
                value: keyInputs[key.index] || '',
                onChange: (event) => setKeyInputs((current) => ({ ...current, [key.index]: event.target.value })),
              })),
            h('td', { className: 'key-row-actions' },
              h('button', {
                className: 'compact',
                type: 'button',
                disabled: !String(keyInputs[key.index] || '').trim() || savingKey !== null,
                onClick: () => saveKey(key.index),
              }, savingKey === key.index ? 'جارٍ الحفظ…' : 'حفظ'),
              key.source === 'database' && h('button', {
                className: 'ghost compact danger',
                type: 'button',
                disabled: deletingKey !== null,
                onClick: () => deleteKey(key.index),
              }, deletingKey === key.index ? 'جارٍ الحذف…' : 'حذف'))))))),
      h('div', { className: 'key-actions' },
        h('button', { className: 'ghost', onClick: testAgnes, disabled: testing || !keys.find((key) => key.index === 1)?.configured },
          testing ? 'جارٍ الاختبار…' : 'اختبار مفتاح النص والصور'),
        h('button', { className: 'ghost', onClick: load }, 'تحديث حالة المفاتيح')),
      h('div', { className: 'key-note' },
        h('b', null, 'طريقة الاستخدام:'),
        h('span', null, '1) الصق مفتاح Agnes رقم 1 واحفظه لتفعيل كتابة القصة وتوليد الصور. 2) أضف المفاتيح من 2 فصاعدًا لتشغيل تحريك المشاهد بالتوازي. 3) اضغط اختبار للتأكد من أن المفتاح الأول يعمل.'),
        h('span', null, 'المفاتيح تُشفّر على الخادم قبل تخزينها في Turso. لا تُعرض قيمتها مرة أخرى في الصفحة، ويمكنك استبدال أي مفتاح أو حذفه من هنا.')),
      message && h('div', { className: 'msg' }, message)),
    job && h('div', { className: 'card job-card' },
      h('div', { className: 'job-head' },
        h('h2', null, job.title || 'مهمة إنتاج جديدة'),
        h('span', { className: 'pill' }, job.status)),
      h('p', null, currentStage),
      h('div', { className: 'progress-track' },
        h('div', { className: 'progress-fill', style: { width: String(job.progress || 0) + '%' } })),
      h('div', { className: 'row spread' },
        h('small', null, 'التقدم: ' + (job.progress || 0) + '%'),
        h('small', null, 'المهمة: ' + job.id.slice(0, 8))),
      h('div', { className: 'stats' },
        h('div', null, h('b', null, doneImages + '/' + (job.sceneCount || 0)), h('small', null, 'صور جاهزة')),
        h('div', null, h('b', null, doneClips + '/' + (job.sceneCount || 0)), h('small', null, 'مقاطع متحركة'))),
      sceneRows.length > 0 && h('div', { className: 'scene-list' },
        sceneRows.map((scene) => h('div', { className: 'scene-row', key: scene.sceneId },
          h('b', null, 'مشهد ' + scene.n),
          h('span', null, scene.imageStatus === 'done' ? 'الصورة جاهزة' : 'بانتظار الصورة'),
          h('span', null, scene.motionStatus === 'done' ? 'الفيديو جاهز' : scene.motionStatus === 'running' ? 'جارٍ التحريك' : scene.motionProvider === 'fal' ? 'تحريك احتياطي' : 'بانتظار التحريك')))),
      job.lastError && h('div', { className: 'msg' }, 'آخر ملاحظة: ' + job.lastError),
      job.error && h('div', { className: 'msg error-msg' }, job.error),
      job.finalPath && h('div', { className: 'msg' }, 'مسار الفيديو النهائي: ' + job.finalPath)),
  );
}
