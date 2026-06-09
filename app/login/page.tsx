'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Scissors, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      setErrorMsg(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 p-4 font-sans">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-500">
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-10 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-black/10 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2"></div>
          
          <div className="relative z-10">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/30 shadow-lg">
              <Scissors className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">LiNo</h1>
            <p className="text-indigo-100 mt-2 text-sm font-medium">美容師向け予約・カルテ管理システム</p>
          </div>
        </div>

        <div className="p-8">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 text-center">管理者ログイン</h2>
          
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm font-medium text-center">
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full py-3.5 px-4 bg-white dark:bg-slate-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-700 dark:text-gray-200 font-bold hover:bg-gray-50 dark:hover:bg-slate-600 transition duration-200 flex items-center justify-center gap-3 shadow-sm active:scale-[0.98]"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            )}
            {loading ? 'リダイレクト中...' : 'Google アカウントでログイン'}
          </button>

          <p className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400">
            ログインすることで、<a href="#" className="underline hover:text-indigo-500">利用規約</a>と<a href="#" className="underline hover:text-indigo-500">プライバシーポリシー</a>に同意したものとみなされます。
          </p>
        </div>
      </div>
    </div>
  );
}
