// Operational traffic gate, not an authorization or database security boundary.
// Do not add secret query-string bypasses or allow unsigned webhook acknowledgments.
const publicPages = new Set(['/terms', '/privacy', '/commercial-disclosure']);
export function isMaintenanceBlocked(pathname: string, mode: string | undefined): boolean {
  if (mode !== 'true') return false;
  const path = pathname.replace(/\/+$/, '') || '/';
  return !publicPages.has(path);
}
export const maintenanceHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  'Retry-After': '300',
  'X-Robots-Tag': 'noindex',
};
export const maintenanceHtml = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>メンテナンス中 | LiNo</title><style>body{margin:0;background:#f8fafc;color:#0f172a;font-family:system-ui,sans-serif}main{max-width:38rem;margin:12vh auto;padding:2rem}h1{font-size:1.75rem}p{line-height:1.9}a{color:#4338ca}nav{display:flex;flex-wrap:wrap;gap:1rem;margin-top:2rem}</style></head><body><main><p>LiNo</p><h1>ただいまメンテナンス中です</h1><p>サービスの更新作業を行っています。しばらく時間をおいてから、もう一度アクセスしてください。</p><p>操作の途中でこの画面が表示された場合は、再開後に登録・契約の状態をご確認ください。同じ申込みを繰り返さないようお願いいたします。</p><p>お問い合わせ：<a href="mailto:pony.soma@gmail.com">pony.soma@gmail.com</a></p><nav aria-label="利用条件"><a href="/terms">利用規約</a><a href="/privacy">プライバシーポリシー</a><a href="/commercial-disclosure">特定商取引法に基づく表記</a></nav></main></body></html>`;
