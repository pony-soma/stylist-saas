import Link from 'next/link';
import { ArrowRight, Scissors, CalendarCheck, MessageCircle, Star } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed w-full bg-white/80 backdrop-blur-md z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center">
                <Scissors className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-gray-900">LiNo</span>
            </div>
            <div>
              <Link href="/admin" className="text-sm font-medium text-gray-700 hover:text-indigo-600 transition mr-6">
                ログイン
              </Link>
              <Link href="/admin" className="text-sm font-bold bg-indigo-600 text-white px-5 py-2.5 rounded-full hover:bg-indigo-700 transition shadow-md hover:shadow-lg">
                無料で始める
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 sm:pt-40 sm:pb-28 px-4 sm:px-6 lg:px-8 overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-100 via-white to-white -z-10"></div>
        <div className="max-w-7xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm font-medium mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Star className="w-4 h-4 text-orange-400" />
            <span>美容師専用の予約・顧客管理システム</span>
          </div>
          <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight text-gray-900 mb-8 leading-tight animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
            あなたの美容室に、<br className="hidden sm:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">最高の顧客体験</span>を。
          </h1>
          <p className="max-w-2xl mx-auto text-lg sm:text-xl text-gray-500 mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
            LINEを使ったシームレスな予約受付から、直感的なカルテ管理まで。<br className="hidden sm:block" />
            LiNoは、美容師の皆様が「お客様と向き合う時間」を最大化します。
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 animate-in fade-in slide-in-from-bottom-10 duration-700 delay-300">
            <Link href="/admin?plan=free" className="w-full sm:w-auto px-8 py-4 bg-white text-gray-900 border-2 border-gray-900 rounded-full font-bold text-lg hover:bg-gray-50 transition shadow-md flex items-center justify-center gap-2">
              14日間無料で試す
            </Link>
            <Link href="/admin?plan=pro" className="w-full sm:w-auto px-8 py-4 bg-gray-900 text-white rounded-full font-bold text-lg hover:bg-gray-800 transition shadow-xl hover:shadow-2xl flex items-center justify-center gap-2 group">
              プロプランで始める
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
          <p className="mt-6 text-sm text-gray-400 animate-in fade-in duration-700 delay-500">※無料トライアルはクレジットカード登録不要です（プロプラン：月額1,980円）</p>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900">LiNoでできること</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 hover:shadow-md transition">
              <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mb-6">
                <MessageCircle className="w-7 h-7 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">LINEで簡単予約</h3>
              <p className="text-gray-500">お客様はいつものLINEから数タップで予約完了。専用アプリのインストールは不要です。</p>
            </div>
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 hover:shadow-md transition">
              <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mb-6">
                <CalendarCheck className="w-7 h-7 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">直感的なスケジュール</h3>
              <p className="text-gray-500">予約状況が一目でわかるダッシュボード。自動でLINE通知も送信され、ドタキャンを防ぎます。</p>
            </div>
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 hover:shadow-md transition">
              <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mb-6">
                <Scissors className="w-7 h-7 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">写真つき電子カルテ</h3>
              <p className="text-gray-500">来店ごとの施術内容や使用薬剤、仕上がりの写真をスマホからサクサク保存できます。</p>
            </div>
          </div>
        </div>
      </section>
      
      {/* Footer */}
      <footer className="bg-white border-t border-gray-100 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-400 text-sm">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Scissors className="w-4 h-4" />
            <span className="font-bold">LiNo</span>
          </div>
          <p>&copy; {new Date().getFullYear()} LiNo. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
