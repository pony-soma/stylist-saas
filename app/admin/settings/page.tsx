import Link from 'next/link';
import AccountSwitcher from '@/components/AccountSwitcher';
import { SubscriptionBanner } from '@/components/admin/SubscriptionBanner';
import { ArrowLeft, Scissors, MessageCircle, ChevronRight, CreditCard, Clock } from 'lucide-react';

const settings = [
  { href: '/billing', title: '契約・お支払い', description: '無料体験の期限、お支払い情報、解約を確認・管理します', icon: CreditCard },
  { href: '/admin/menus', title: 'メニュー設定', description: 'メニューの料金と所要時間を管理します', icon: Scissors },
  { href: '/admin/schedule/settings', title: '営業時間・定休日設定', description: '営業時間、定休日、特定日の営業予定を設定します', icon: Clock },
  { href: '/admin/settings/line', title: 'LINE通知設定', description: '新しい予約リクエストを、ご自身のLINEで受け取ります', icon: MessageCircle },
];
export default function SettingsHubPage() {
  return <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
    <Link href="/admin" className="inline-flex min-h-11 items-center gap-2 text-sm text-gray-500 hover:text-indigo-600"><ArrowLeft className="h-4 w-4" />ダッシュボードに戻る</Link>
    <header className="my-8"><p className="eyebrow">Your workspace</p><h1 className="mt-3 text-3xl font-bold tracking-tight">設定</h1><p className="mt-3 text-sm text-gray-500">あなたの働き方に合わせて、LiNoを整える。</p></header>
    <SubscriptionBanner />
    <section aria-label="サービスの設定" className="surface overflow-hidden divide-y divide-gray-100 dark:divide-slate-800">
      {settings.map(({href,title,description,icon:Icon}) => <Link key={href} href={href} className="setting-row group">
        <span className="setting-icon"><Icon className="h-5 w-5" strokeWidth={1.6} /></span>
        <div className="min-w-0 flex-1"><h2 className="text-base font-semibold group-hover:text-indigo-600">{title}</h2><p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-gray-500">{description}</p></div>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
      </Link>)}
    </section>
    <h2 className="mt-10 mb-3 text-sm font-semibold text-gray-600">アカウント</h2>
    <AccountSwitcher />
  </div>;
}
