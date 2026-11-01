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
