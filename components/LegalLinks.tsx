import Link from 'next/link';

export default function LegalLinks() {
  return <nav aria-label="利用条件・お問い合わせ" className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-3 text-sm text-slate-600 dark:text-slate-400">
    <Link className="underline" href="/terms">利用規約</Link>
    <Link className="underline" href="/privacy">プライバシーポリシー</Link>
    <Link className="underline" href="/commercial-disclosure">特定商取引法に基づく表記</Link>
    <a className="underline" href="mailto:pony.soma@gmail.com">お問い合わせ</a>
  </nav>;
}
