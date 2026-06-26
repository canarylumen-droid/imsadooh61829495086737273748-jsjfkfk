import { useState } from 'react';
import { X } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Simulate login delay
    setTimeout(() => {
      if (!email || !password) {
        setError('Please fill in all fields');
        setLoading(false);
        return;
      }

      if (!email.includes('@')) {
        setError('Please enter a valid email');
        setLoading(false);
        return;
      }

      // Store user in localStorage
      localStorage.setItem(
        'audnix_user',
        JSON.stringify({
          email,
          loginTime: new Date().toISOString(),
        })
      );

      // Close modal and reset
      setEmail('');
      setPassword('');
      setLoading(false);
      onClose();
    }, 500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[#050505] border border-[#1e1e1e] rounded-lg max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#1e1e1e]">
          <h2 className="font-display text-2xl tracking-[0.15em] text-[#f2ede6]">
            LOGIN
          </h2>
          <button
            onClick={onClose}
            className="text-[#7a7a7a] hover:text-[#f2ede6] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleLogin} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* Email */}
          <div className="space-y-2">
            <label className="block font-mono text-xs tracking-widest text-[#d0cdc5]">
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#1e1e1e] px-4 py-3 font-mono text-sm text-[#f2ede6] placeholder-[#3a3a3a] focus:outline-none focus:border-[#2196f3] transition-colors"
              placeholder="you@example.com"
              disabled={loading}
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <label className="block font-mono text-xs tracking-widest text-[#d0cdc5]">
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#1e1e1e] px-4 py-3 font-mono text-sm text-[#f2ede6] placeholder-[#3a3a3a] focus:outline-none focus:border-[#2196f3] transition-colors"
              placeholder="••••••••"
              disabled={loading}
            />
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#2196f3] text-[#050505] py-3 font-mono text-sm tracking-widest font-semibold hover:bg-[#42a5f5] disabled:opacity-50 transition-colors"
          >
            {loading ? 'LOGGING IN...' : 'LOGIN'}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#1e1e1e]" />
            <span className="font-mono text-xs text-[#7a7a7a]">OR</span>
            <div className="flex-1 h-px bg-[#1e1e1e]" />
          </div>

          {/* Demo login */}
          <button
            type="button"
            onClick={() => {
              setEmail('demo@audnix.ai');
              setPassword('demo123');
            }}
            disabled={loading}
            className="w-full bg-[#0a0a0a] border border-[#1e1e1e] text-[#d0cdc5] py-3 font-mono text-sm tracking-widest hover:border-[#2196f3] hover:text-[#2196f3] transition-colors disabled:opacity-50"
          >
            TRY DEMO ACCOUNT
          </button>
        </form>
      </div>
    </div>
  );
}
