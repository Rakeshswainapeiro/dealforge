import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

// Session-backed sign-in screen. Authentication is provided by Better Auth
// (email + password); a successful sign-in sets the session cookie and the
// app then resolves the actor from /api/org/me.
export default function Login() {
  const { login, appPublicSettings } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [ssoSubmitting, setSsoSubmitting] = useState(false);

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

  // Single sign-on (W8-01 / PLT-04): resolve the email domain to a registered
  // provider and hand the browser to the IdP. Accounts on an approved domain
  // can still use the password form below.
  const onSso = async () => {
    setError(null);
    if (!email.trim()) {
      setError('Enter your work email to continue with single sign-on.');
      return;
    }
    setSsoSubmitting(true);
    try {
      const url = await api.auth.loginWithSso(email.trim(), '/');
      if (url) window.location.assign(url);
      else setError('Single sign-on is not available for this account.');
    } catch (err) {
      setError(err?.message || 'Single sign-on is not available for this account');
    } finally {
      setSsoSubmitting(false);
    }
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
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
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
            {error ? (
              <p className="text-sm text-red-600" role="alert">{error}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              data-testid="login-sso"
              disabled={ssoSubmitting}
              onClick={onSso}
            >
              {ssoSubmitting ? 'Redirecting…' : 'Sign in with SSO'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
