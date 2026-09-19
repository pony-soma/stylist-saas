import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
    <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm sm:p-10">
      <Link href="/" className="font-bold text-indigo-700">LiNo トップへ</Link>
      <article className="mt-8 space-y-6 leading-8 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_p]:mt-2">{children}</article>
      <LegalLinks />
    </div>
  </main>;
}
