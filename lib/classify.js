// يقرر هل الخطأ بسبب المفتاح (نبدّل المفتاح) ولا بسبب الطلب نفسه (نرمي الخطأ).
// err.status = HTTP status إن وجد.
export function classify(err) {
  const s = err?.status;
  const msg = String(err?.message || '').toLowerCase();

  if (s === 401 || s === 403) {
    return { status: 'disabled', cooldownSec: 0, reason: 'auth' };
  }
  if (msg.includes('quota') || msg.includes('insufficient') || msg.includes('exceeded your')) {
    return { status: 'cooling', cooldownSec: 6 * 3600, reason: 'quota' };
  }
  if (s === 429 || msg.includes('rate limit')) {
    // الفري تير: RPM 20 → دقيقة وشوية تكفي
    return { status: 'cooling', cooldownSec: 70, reason: 'rate_limit' };
  }
  if (s === undefined || s >= 500) {
    // خطأ شبكة أو مشكلة عند المزود
    return { status: 'cooling', cooldownSec: 30, reason: 'transient' };
  }
  return null; // 400/404/422... مشكلة في الطلب نفسه، تبديل المفتاح مش هيفيد
}
