import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gray-50">
      <h1 className="text-4xl font-bold mb-8">Stylist SaaS UI Demo</h1>
      <div className="flex gap-4">
        <Link href="/admin" className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md">
          管理者ダッシュボードを見る
        </Link>
        <Link href="/liff" className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-md">
          LIFF 予約画面を見る
        </Link>
      </div>
    </main>
  );
}
