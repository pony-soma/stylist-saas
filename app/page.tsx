import LegalLinks from '@/components/LegalLinks';
import Link from 'next/link';
import { ArrowRight, Scissors, MessageCircle, Users, Check, CalendarCheck } from 'lucide-react';

export default function Home() {
  return <div className="min-h-screen bg-gray-50 text-gray-900">
    <nav aria-label="メインナビゲーション" className="border-b border-gray-200 bg-gray-50/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <Link href="/" className="brand-wordmark shrink-0 text-indigo-800">LiNo</Link>
        <div className="flex shrink-0 items-center gap-2 sm:gap-7"><Link href="/login?next=/billing" className="whitespace-nowrap text-xs font-semibold sm:text-sm">ログイン</Link><Link href="/login?next=/billing" className="whitespace-nowrap rounded-full bg-indigo-700 px-3 py-3 text-xs sm:text-sm font-semibold text-white">14日間無料で試す</Link></div>
      </div>
    </nav>
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="eyebrow">For independent stylists</p>
          <p className="mt-4 text-sm text-gray-600">フリーランス美容師のための予約・顧客管理</p>
          <h1 className="mt-7 text-3xl font-semibold leading-[1.5] tracking-tight sm:text-5xl sm:leading-[1.5]">予約リクエストを、<br />あなたのLINEへ。</h1>
          <p className="mt-7 max-w-md text-base leading-8 text-gray-600">お客様はLINEの予約URLからメニューと日時を選択。新しい予約リクエストを、連携した美容師のLINEへお知らせします。予約の確認・管理と、お客様ごとの施術記録はLiNoで。</p>
          <Link href="/login?next=/billing" className="primary-action mt-9">14日間無料で試す<ArrowRight className="h-4 w-4" /></Link>
          <p className="mt-5 text-sm font-medium">月額1,980円（税込）</p>
          <p className="mt-2 max-w-md text-xs leading-6 text-gray-500">初回14日間無料・カード登録必須。体験終了前に解約しない場合、月額1,980円（税込）で自動更新します。</p>
        </div>
        <div className="relative rounded-[2rem] bg-[#e4eadd] p-6 sm:p-10">
          <p className="mb-5 text-xs tracking-widest text-indigo-700">ひとりひとりを、大切に。</p>
          <div className="rounded-2xl border border-white bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 pb-5"><span className="brand-wordmark text-indigo-800">LiNo</span><span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">画面イメージ</span></div>
            <div className="mt-6 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-700"><CalendarCheck className="h-5 w-5" /></span><div><p className="font-semibold">次のご来店が、楽しみになる。</p><p className="mt-1 text-xs text-gray-500">予約・顧客情報・施術記録をひとつに</p></div></div>
            <div className="mt-6 space-y-3">{['LINEから届いた予約を確認','前回のカラーと仕上がりを振り返る','今日の施術を写真と一緒に記録'].map((text,i) => <div key={text} className="flex items-center gap-3 rounded-xl bg-gray-50 p-4 text-sm"><span className="text-xs text-indigo-600">0{i+1}</span>{text}<Check className="ml-auto h-4 w-4 shrink-0 text-indigo-500" /></div>)}</div>
          </div>
          <p className="mt-6 text-center font-serif text-lg italic text-indigo-700">Less admin. More connection.</p>
        </div>
      </section>
      <section className="border-y border-gray-200 bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8"><p className="eyebrow">Made for your everyday</p><h2 className="mt-4 text-2xl font-semibold sm:text-3xl">接客の前も、後も。頼れる相棒に。</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">{[
            {icon:MessageCircle,title:'予約の入口を、LINEに。',body:'お客様はLINEの予約URLからメニューと日時を選択。届いた予約リクエストを、担当美容師のLINE通知と管理画面で確認できます。'},
            {icon:Users,title:'「いつもの」を、忘れない。',body:'来店履歴とお客様の情報をまとめて管理。好みや前回の施術を振り返り、一人ひとりに合う接客へつなげます。'},
            {icon:Scissors,title:'仕上がりも、記憶に残す。',body:'施術内容、使用薬剤、仕上がりの写真をカルテに保存。次のご来店に役立つ記録を、スマホから残せます。'},
          ].map(({icon:Icon,title,body}) => <article key={title} className="rounded-2xl bg-gray-50 p-7"><Icon className="h-7 w-7 text-indigo-600" strokeWidth={1.4} /><h3 className="mt-6 text-lg font-semibold">{title}</h3><p className="mt-4 text-sm leading-7 text-gray-600">{body}</p></article>)}</div>
        </div>
      </section>
      <section className="mx-auto max-w-3xl px-5 py-16 text-center sm:py-24"><p className="eyebrow">Your next chapter</p><h2 className="mt-5 text-2xl font-semibold leading-relaxed sm:text-3xl">あなたらしい働き方を、<br />LiNoと始めませんか。</h2><Link href="/login?next=/billing" className="primary-action mt-8">14日間無料で試す<ArrowRight className="h-4 w-4" /></Link><p className="mt-4 text-xs leading-6 text-gray-500">カード登録が必要です。無料体験終了後は月額1,980円（税込）で自動更新。<br />課金開始前に解約すれば料金は発生しません。</p></section>
    </main>
    <footer className="border-t border-gray-200 bg-white px-5 py-10 text-center"><p className="brand-wordmark text-indigo-800">LiNo</p><LegalLinks /><p className="mt-6 text-xs text-gray-500">© {new Date().getFullYear()} LiNo</p></footer>
  </div>;
}
