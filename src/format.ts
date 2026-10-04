export function money(cents: number, currency = 'USD', compact = false): string {
  const safe = Number.isFinite(cents) ? cents / 100 : 0;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: compact ? 0 : 2, minimumFractionDigits: compact ? 0 : 2 }).format(safe); }
  catch { return `${safe.toLocaleString('en-US', {maximumFractionDigits: 2})} units`; }
}
export function shortDate(date: string) { return new Date(`${date.slice(0,10)}T12:00:00`).toLocaleDateString('en-US', {month:'short',day:'numeric'}); }
export function monthName(month: string) { return new Date(`${month}-15T12:00:00`).toLocaleDateString('en-US', {month:'long',year:'numeric'}); }
export function currentMonth() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`; }
export function relativeDate(date: string | null) { if(!date) return 'Not synced yet'; const minutes=Math.max(0, Math.floor((Date.now()-new Date(date).getTime())/60000)); return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes/60)}h ago` : `${Math.floor(minutes/1440)}d ago`; }
