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
      error && h('div', { className: 'msg' }, error)));
}

const stageNames = {
  story: 'كتابة القصة JSON',
  images: 'توليد صور المشاهد',
  motion: 'تحريك المشاهد بالتوازي',
  ready_for_assembly: 'المشاهد اكتملت — جاهزة للتجميع',
  completed: 'اكتمل الفيديو النهائي',
  failed: 'تعذر إكمال المهمة',
};

export default function Page() {
  const [authed, setAuthed] = useState(null);
  const [lamps, setLamps] = useState([]);
  const [keys, setKeys] = useState([]);
  const [theme, setTheme] = useState('قصة سينمائية للأطفال عن الثعلب وقيمة أخلاقية ونهاية مفاجئة');
  const [job, setJob] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
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
    setKeys(keyInfo.keys || []);
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

  if (authed === null) return h('main', null, 'جاري التحميل…');
  if (authed === false) return h(Login, { onDone: load });

  const startStory = async () => {
    setBusy(true);
    setMessage('تم إرسال طلب إنشاء القصة…');
    try {
      const result = await post('/api/jobs', { theme });
      if (!result.ok || !result.job) throw new Error(result.error || 'تعذر إنشاء المهمة');
      setJob(result.job);
      setMessage('بدأت المهمة. المتصفح يتابع التقدم كل 5 ثوانٍ.');
      await post('/api/jobs/tick', { jobId: result.job.id });
    } catch (error) {
      setMessage('خطأ: ' + error.message);
    } finally {
      setBusy(false);
      load();
    }
  };

  const testAgnes = async () => {
    setTesting(true);
    setMessage('اختبار مفتاح Agnes رقم 1…');
    const result = await post('/api/test-agnes');
    setMessage(result.ok ? '✅ Agnes متصل: ' + result.reply : '❌ ' + result.error);
    setTesting(false);
  };

  const currentStage = job ? stageNames[job.stage] || job.stage : '';
  const sceneRows = job?.scenes || [];
  const doneImages = sceneRows.filter((scene) => scene.imageStatus === 'done').length;
  const doneClips = sceneRows.filter((scene) => scene.motionStatus === 'done').length;

  return h('main', null,
    h('header', { className: 'topbar' },
      h('div', null, h('h1', null, 'StoryLoop'), h('p', null, 'خط إنتاج قصصي غير متزامن')),
      h('span', { className: 'pill' }, 'Environment-only keys')),
    h('div', { className: 'card' },
      h('h2', null, 'حالة الأنظمة'),
      lamps.map((lamp) => h(Lamp, { key: lamp.id, lamp }))),
    h('div', { className: 'card' },
      h('h2', null, 'إنشاء قصة جديدة'),
      h('label', { htmlFor: 'story-theme' }, 'فكرة القصة'),
      h('textarea', {
        id: 'story-theme',
        value: theme,
        onChange: (event) => setTheme(event.target.value),
        placeholder: 'اكتب موضوع القصة أو الفكرة الرئيسية…',
      }),
      h('div', { className: 'row' },
        h('button', { onClick: startStory, disabled: busy || !theme.trim() }, busy ? 'جارٍ الإرسال…' : 'ابدأ خط الإنتاج'),
        h('button', { className: 'ghost', onClick: testAgnes, disabled: testing }, 'اختبار مفتاح النص والصور')),
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
    h('div', { className: 'card' },
      h('h2', null, 'مفاتيح Agnes من Environment Variables'),
      h('p', null, 'لا تُحفظ المفاتيح في Turso أو Redis، ولا يمكن إضافتها من لوحة التحكم.'),
      keys.length === 0
        ? h('div', { className: 'msg' }, 'لم يتم العثور على AGNES_API_KEY_1 أو المفاتيح المرقمة.')
        : h('table', null,
          h('thead', null, h('tr', null, ['رقم', 'المفتاح', 'الدور'].map((label, index) => h('th', { key: index }, label)))),
          h('tbody', null, keys.map((key) => h('tr', { key: key.index },
            h('td', null, key.index),
            h('td', { className: 'mono' }, key.masked),
            h('td', null, key.role === 'story-images' ? 'النص + الصور بالتتابع' : 'تحريك متوازٍ'))))))),
  );
}
