import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

// Primary sign-in is the organisation's Microsoft account (one tenant for everyone),
// so there is no email step: the identity provider shows its own sign-in page.
// Email + password stays only for break-glass / approved local accounts, behind a link.
const SSO_PROVIDER_ID = import.meta.env.VITE_SSO_PROVIDER_ID || 'microsoft';
const SSO_PROVIDER_LABEL = import.meta.env.VITE_SSO_PROVIDER_LABEL || 'Microsoft';

export default function Login() {
  const { login, appPublicSettings } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [ssoSubmitting, setSsoSubmitting] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const appName = appPublicSettings?.public_settings?.appName || 'DealForge';

  const onSubmit = async (e) => {
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

  // Single sign-on (W8-01 / PLT-04): hand the browser straight to the configured provider.
  const onSso = async () => {
    setError(null);
    setSsoSubmitting(true);
    try {
      const url = await api.auth.loginWithProvider(SSO_PROVIDER_ID, '/');
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-slate-900 text-white flex items-center justify-center font-semibold">DF</div>
            <CardTitle className="text-2xl">{appName}</CardTitle>
          </div>
          <CardDescription>Sign in to continue to the deal platform.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            className="w-full"
            data-testid="login-sso"
            disabled={ssoSubmitting}
            onClick={onSso}
          >
            {ssoSubmitting ? 'Redirecting…' : `Sign in with ${SSO_PROVIDER_LABEL}`}
          </Button>

          {error ? (
            <p className="text-sm text-red-600" role="alert">{error}</p>
          ) : null}

          {showPasswordForm ? (
            <form onSubmit={onSubmit} className="space-y-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.local"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                />
              </div>
              <Button type="submit" variant="outline" className="w-full" disabled={submitting}>
                {submitting ? 'Signing in...' : 'Sign in with password'}
              </Button>
            </form>
          ) : (
            <button
              type="button"
              data-testid="login-show-password"
              className="w-full text-center text-sm text-slate-500 hover:text-slate-800 hover:underline underline-offset-4"
              onClick={() => { setError(null); setShowPasswordForm(true); }}
            >
              Sign in with email and password instead
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}