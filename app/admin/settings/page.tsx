import Link from 'next/link';
import { ArrowLeft, Menu as MenuIcon, MessageCircle, ChevronRight } from 'lucide-react';

export default function SettingsHubPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
      <div className="mb-6">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 transition font-medium">
          <ArrowLeft className="w-4 h-4" />
          ダッシュボードに戻る
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">設定</h1>
        <p className="text-gray-500 mt-1">店舗のメニューや各種連携を設定します</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          
          <Link href="/admin/menus" className="flex items-center p-6 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition group">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mr-4">
              <MenuIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-indigo-600 transition">メニュー設定</h2>
              <p className="text-sm text-gray-500 mt-0.5">提供するメニューの料金や所要時間を管理します</p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-indigo-500 transition translate-x-0 group-hover:translate-x-1" />
          </Link>

          <Link href="/admin/settings/line" className="flex items-center p-6 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition group">
            <div className="w-12 h-12 rounded-xl bg-[#06C755]/10 flex items-center justify-center mr-4">
              <MessageCircle className="w-6 h-6 text-[#06C755]" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-[#06C755] transition">LINE通知設定</h2>
              <p className="text-sm text-gray-500 mt-0.5">予約が入った際のLINEへの通知連携を設定します</p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-[#06C755] transition translate-x-0 group-hover:translate-x-1" />
          </Link>

        </div>
      </div>
    </div>
  );
}
