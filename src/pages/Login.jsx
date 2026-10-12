import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Users, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SSO_PROVIDER_ID = import.meta.env.VITE_SSO_PROVIDER_ID || 'microsoft';
const BRAND_GREEN = 'text-[#5DB563]';

// Friendly text for errors the sign-in flow sends back as ?error=...
// Only known codes are mapped. The raw query value is never shown, because anyone can
// craft a link to this page with arbitrary text in it.
const SIGN_IN_ERRORS = {
  'signup disabled': 'No account found with this email. Ask your administrator to create your account first.',
  'account not linked': 'Your organisation account could not be connected to DealForge. Ask your administrator.',
  access_denied: 'Sign-in was cancelled.',
  banned: 'This account has been blocked. Contact an administrator.',
};
const DEFAULT_SIGN_IN_ERROR = 'We could not sign you in. Try again, or contact your administrator.';

function signInErrorFromUrl() {
  const code = new URLSearchParams(window.location.search).get('error');
  return code ? SIGN_IN_ERRORS[code] || DEFAULT_SIGN_IN_ERROR : null;
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function BrandMark({ onDark = true }) {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 24 24" className="h-9 w-9 shrink-0" aria-hidden="true">
        <path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Z" fill="#5DB563" />
        <path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="leading-none">
        <p className="text-2xl font-bold">
          <span className={onDark ? 'text-white' : 'text-slate-900'}>Deal</span>
          <span className={BRAND_GREEN}>Forge</span>
        </p>
        <p className={`mt-1 text-xs tracking-[0.3em] ${onDark ? 'text-neutral-300' : 'text-slate-500'}`}>M&amp;A ANALYSIS</p>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, text }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-700">
        <Icon className="h-4 w-4 text-neutral-300" aria-hidden="true" />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-neutral-400">{text}</p>
      </div>
    </li>
  );
}

function BrandPanel() {
  return (
    <aside className="hidden flex-col justify-between rounded-xl bg-[#0B0B0B] p-10 text-white lg:flex xl:p-14">
      <div className="space-y-10">
        <BrandMark />
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Investment Team Portal</p>
          <h1 className="text-4xl font-bold leading-tight xl:text-5xl">
            Investment opportunities, <span className={BRAND_GREEN}>in one place.</span>
          </h1>
        </div>
        <ul className="space-y-5">
          <Feature icon={KeyRound} title="One sign-in" text="Use your organisation account. No separate DealForge password." />
          <Feature icon={ShieldCheck} title="A second check, every time" text="You confirm a code on each sign-in." />
          <Feature icon={Users} title="You see what your role allows" text="Each company sees only its own opportunities. The Investment Team sees all of them." />
        </ul>
      </div>
      <p className="text-sm text-neutral-400">
        Sirius International Holding. <span className="mx-1 text-neutral-600">|</span> Every sign-in, successful or not, is recorded.
      </p>
    </aside>
  );
}

function FailedPanel({ message, onBack }) {
  return (
    <div className="text-center" role="alert">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
        <X className="h-4 w-4 text-red-600" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-3xl font-bold text-slate-900">Sign-in failed</h2>
      <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p>
      <Button type="button" variant="outline" className="mt-4 w-full" onClick={onBack}>
        Back to sign in
      </Button>
    </div>
  );
}

// Organisation sign-in (W8-01 / PLT-04). Password sign-in is only for the break-glass
// administrator and appears only when the page is opened with ?method=password.
export default function Login() {
  const { login } = useAuth();
  const [failure, setFailure] = useState(signInErrorFromUrl);
  const [showPasswordForm] = useState(() => new URLSearchParams(window.location.search).get('method') === 'password');
  const [error, setError] = useState(null);
  const [ssoSubmitting, setSsoSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Remove ?error=... from the address bar so a refresh doesn't show the failure again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('error')) return;
    params.delete('error');
    params.delete('error_description');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  }, []);

  const onSso = async () => {
    setError(null);
    setSsoSubmitting(true);
    try {
      const url = await api.auth.loginWithProvider(SSO_PROVIDER_ID, '/', window.location.pathname);
      if (url) {
        window.location.assign(url);
        return;
      }
      setError('Single sign-on is not available right now.');
    } catch (err) {
      setError(err?.message || 'Single sign-on is not available right now.');
    }
    setSsoSubmitting(false);
  };

  const onPasswordSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      window.location.assign('/');
    } catch (err) {
      setError(err?.message || 'Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white p-3 sm:p-4">
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-4 sm:min-h-[calc(100vh-2rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <BrandPanel />
        <main className="flex items-center justify-center px-4 py-10 sm:px-10">
          <div className="w-full max-w-md">
            <div className="mb-10 lg:hidden">
              <BrandMark onDark={false} />
            </div>

            {failure ? (
              <FailedPanel message={failure} onBack={() => setFailure(null)} />
            ) : (
              <>
                <h2 className="text-3xl font-bold text-slate-900">Sign in</h2>
                <p className="mt-2 text-sm text-slate-600">Use the account your organisation gave you.</p>

                <Button
                  type="button"
                  data-testid="login-sso"
                  onClick={onSso}
                  disabled={ssoSubmitting}
                  className="mt-5 h-11 w-full gap-2 bg-[#3B7C72] text-white hover:bg-[#33695F]"
                >
                  <MicrosoftLogo />
                  {ssoSubmitting ? 'Redirecting…' : 'Sign in with your organisation account'}
                </Button>

                {error ? <p className="mt-3 text-sm text-red-600" role="alert">{error}</p> : null}

                <p className="mt-4 text-xs text-slate-500">
                  For Sirius and subsidiary staff. You will continue on your organisation's sign-in page, such as Microsoft Entra ID.
                </p>

                {showPasswordForm ? (
                  <form onSubmit={onPasswordSubmit} className="mt-8 space-y-4 border-t pt-6">
                    <p className="text-sm font-medium text-slate-900">Administrator sign-in</p>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                    </div>
                    <Button type="submit" variant="outline" className="w-full" disabled={submitting}>
                      {submitting ? 'Signing in…' : 'Sign in with password'}
                    </Button>
                  </form>
                ) : null}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}