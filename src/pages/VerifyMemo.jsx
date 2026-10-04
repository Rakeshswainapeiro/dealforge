import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from 'lucide-react';

// Public memo verification page (W7-05 / BRD OUT-03).
//
// A QR printed on an exported memo points here with id, version, hash and an
// HMAC signature in the query string. The page calls the public verify endpoint
// (no session needed) which recomputes the live record fingerprint: a copy whose
// record has changed, or a forged QR, fails the check. Registered as an
// unauthenticated route so a plain phone camera scan works.
export default function VerifyMemo() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    const token = {
      id: params.get('id') || undefined,
      v: params.get('v') || undefined,
      h: params.get('h') || undefined,
      t: params.get('t') || undefined,
      sig: params.get('sig') || undefined,
    };
    if (!token.id || !token.h) {
      setState({ status: 'done', valid: false, message: 'This QR is missing its reference. Scan the QR printed on the memo.' });
      return;
    }
    let cancelled = false;
    api.memoVerification.verify(token)
      .then((data) => { if (!cancelled) setState({ status: 'done', ...data }); })
      .catch((err) => { if (!cancelled) setState({ status: 'done', valid: false, message: err?.message || 'Verification request failed.' }); });
    return () => { cancelled = true; };
  }, [params]);

  const loading = state.status === 'loading';
  const valid = state.valid === true;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <Card className="w-full max-w-lg shadow-lg" data-testid="verify-memo-card">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <CardTitle className="text-2xl">Memo verification</CardTitle>
          </div>
          <CardDescription>Confirm an exported Sirius memo against its live record version and hash.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking the record fingerprint...
            </div>
          ) : (
            <>
              <div className={valid ? 'rounded-lg border border-emerald-200 bg-emerald-50 p-4' : 'rounded-lg border border-red-200 bg-red-50'}>
                <div className="flex items-center gap-2">
                  {valid ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
                  <p className={valid ? 'text-sm font-semibold text-emerald-900' : 'text-sm font-semibold text-red-900'} data-testid="verify-memo-status">
                    {state.status_label || state.status || (valid ? 'Verified' : 'Not verified')}
                  </p>
                  <Badge variant="outline" className="ml-auto bg-white">{valid ? 'valid' : 'invalid'}</Badge>
                </div>
                <p className={valid ? 'mt-1 text-xs text-emerald-800' : 'mt-1 text-xs text-red-800'} data-testid="verify-memo-message">
                  {state.message}
                </p>
              </div>

              <dl className="grid grid-cols-[38%_62%] overflow-hidden rounded-lg border border-slate-200 text-xs">
                <dt className="bg-slate-50 px-3 py-2 font-semibold text-slate-700">Record version</dt>
                <dd className="px-3 py-2 font-mono text-slate-800" data-testid="verify-memo-version">{state.version || '—'}</dd>
                <dt className="border-t border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700">Issued hash</dt>
                <dd className="break-all border-t border-slate-200 px-3 py-2 font-mono text-slate-800">{state.issued_hash || '—'}</dd>
                <dt className="border-t border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700">Live hash</dt>
                <dd className="break-all border-t border-slate-200 px-3 py-2 font-mono text-slate-800" data-testid="verify-memo-current-hash">{state.current_hash || '—'}</dd>
                <dt className="border-t border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700">Issued at</dt>
                <dd className="border-t border-slate-200 px-3 py-2 text-slate-800">{state.issued_at || '—'}</dd>
              </dl>

              <Button variant="outline" className="w-full" onClick={() => window.location.assign('/')}>Open DealForge</Button>
            </>
          )}
          <p className="text-[11px] italic text-slate-500">
            The QR binds this copy to the opportunity record version and content hash it was issued from. A record change or a forged QR fails the check.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
