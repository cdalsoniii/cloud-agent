'use client';

import LeanLivePanel from '../components/LeanLivePanel';

export default function LeanLivePage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto flex h-screen max-w-3xl border-x">
        <LeanLivePanel />
      </div>
    </main>
  );
}
