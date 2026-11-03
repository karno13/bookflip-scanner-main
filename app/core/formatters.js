export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}
export function money(value) {
  return value == null
    ? '-'
    : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value / 100);
}
export function date(value) {
  return value ? new Date(value).toLocaleString('pl-PL') : '-';
}
export function shortTime(value) {
  return value
    ? new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
    : '-';
}

// Prices in offer records are integer grosze. User-entered amounts are złote.
export function zlotyToGrosze(value) {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const grosze = Math.round(amount * 100);
  return Number.isSafeInteger(grosze) ? grosze : null;
}
export function groszeToZloty(value) {
  return value == null ? null : Number(value) / 100;
}
export function moneyFromZloty(value) {
  const grosze = zlotyToGrosze(value);
  return grosze === null ? '-' : money(grosze);
}
