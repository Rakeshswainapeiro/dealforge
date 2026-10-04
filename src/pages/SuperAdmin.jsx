/* eslint-disable react/prop-types */
import { useState, useMemo } from 'react';
import { api } from '@/api/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Users, Shield, Building2, Plus, KeyRound, Ban, Activity, Network,
  LayoutDashboard, Link2, Search, Trash2, ShieldAlert, CheckCircle2, AlertCircle,
  Database, RefreshCw, Eraser, PlayCircle,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const ROLE_BADGE = (role) => {
  if (role === 'admin') return 'bg-purple-100 text-purple-800';
  if (['leadership', 'board_member', 'group_compliance'].includes(role)) return 'bg-amber-100 text-amber-800';
  if (role.startsWith('sirius_') || role === 'cio' || role === 'ic_member') return 'bg-blue-100 text-blue-800';
  return 'bg-slate-100 text-slate-800';
};

function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{value ?? '-'}</p>
            {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
          </div>
          <div className="rounded-lg bg-teal-50 p-2">
            <Icon className="h-5 w-5 text-teal-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const INVENTORY_LABELS = [
  ['opportunities', 'Sample opportunities'],
  ['documents', 'Submission documents'],
  ['documentBytes', 'Document bytes'],
  ['pipelineTransitions', 'Pipeline transitions'],
  ['routes', 'Submission routes'],
  ['routeStages', 'Route stages'],
  ['routeParticipants', 'Route participants'],
  ['workflowEvents', 'Workflow events'],
  ['relatedPartyReviews', 'Related-party reviews'],
  ['notifications', 'Seed notifications'],
  ['portfolioRecords', 'Portfolio records'],
  ['seedUsers', 'Seed users'],
  ['seedMemberships', 'Seed memberships'],
  ['authMembers', 'Auth memberships'],
];

const PROFILE_LABEL = {
  base: 'Base reference data',
  mvp: 'Base + MVP fixtures',
  off: 'Off (load nothing)',
};

// Sample-data control (W1-11 / W1-12). Shows the resolved seed profile and a
// live inventory of seed rows, and lets an operator clean or (re)load a profile
// without shelling into the box. Every run is audited server-side.
function SampleDataTab() {
  const qc = useQueryClient();
  const [profile, setProfile] = useState('mvp');
  const [notice, setNotice] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'seed'],
    queryFn: () => api.admin.seedStatus(),
  });

  const mutation = useMutation({
    mutationFn: (payload) => api.admin.seedRun(payload),
    onSuccess: (_res, vars) => {
      const verb = vars.action === 'clean' ? 'Cleaned seed data'
        : vars.action === 'reload' ? 'Reloaded ' + vars.profile + ' seed data'
        : 'Loaded ' + vars.profile + ' seed data';
      setNotice({ ok: true, msg: verb + '.' });
      qc.invalidateQueries({ queryKey: ['admin', 'seed'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (err) => setNotice({ ok: false, msg: err?.message || 'Seed operation failed' }),
  });

  const env = data?.config?.env || [];
  const inventory = data?.inventory || {};
  const error = data?.error;

  const run = (action) => {
    setNotice(null);
    mutation.mutate({ action, profile, force: true });
  };

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-teal-600" /> Sample-data profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-6">
          {isLoading ? (
            <p className="text-slate-500">Loading seed status…</p>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Resolved profile</p>
                <p className="mt-1 flex items-center gap-2">
                  <Badge className="bg-teal-100 text-teal-800">{data?.profile ?? '—'}</Badge>
                  <span className="text-sm text-slate-600">{PROFILE_LABEL[data?.profile] || ''}</span>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Environment</p>
                <p className="mt-1 font-mono text-xs text-slate-600">{env.map((k) => k).join(' · ') || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">Load profile</span>
                <Select value={profile} onValueChange={setProfile}>
                  <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="base">Base reference data</SelectItem>
                    <SelectItem value="mvp">Base + MVP fixtures</SelectItem>
                    <SelectItem value="off">Off (load nothing)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {error && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-900">Seed profile error: {error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" disabled={mutation.isPending} onClick={() => run('clean')}>
              <Eraser className="mr-2 h-4 w-4" /> Clean seed data
            </Button>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => run('load')}>
              <PlayCircle className="mr-2 h-4 w-4" /> Load profile
            </Button>
            <Button disabled={mutation.isPending} onClick={() => run('reload')}>
              <RefreshCw className={`mr-2 h-4 w-4 ${mutation.isPending ? 'animate-spin' : ''}`} /> Reload (clean + load)
            </Button>
          </div>

          {notice && (
            <Alert className={notice.ok ? 'border-teal-200 bg-teal-50' : 'border-red-200 bg-red-50'}>
              {notice.ok ? <CheckCircle2 className="h-4 w-4 text-teal-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
              <AlertDescription className={notice.ok ? 'text-teal-900' : 'text-red-900'}>{notice.msg}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-teal-600" /> Seed inventory
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          {INVENTORY_LABELS.map(([key, label]) => (
            <div key={key} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{inventory[key] ?? '—'}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}


// Authentication policy (W8-01 / BRD PLT-04). Group MFA mode + enforcement, the
// approved local-account domains and the registered SSO providers. The policy is
// stored in AppSettings and enforced by Better Auth + the app-route middleware.
function SecurityTab() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(null);
  const [provider, setProvider] = useState({ kind: 'oidc', provider_id: '', label: '', domain: '', issuer: '', client_id: '', client_secret: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['authPolicy', 'config'],
    queryFn: () => api.authPolicy.config(),
  });

  const config = form || data?.config || null;
  const setField = (k, v) => setForm({ ...(form || data?.config || {}), [k]: v });

  const save = useMutation({
    mutationFn: (payload) => api.authPolicy.savePolicy(payload),
    onSuccess: () => {
      setNotice({ ok: true, msg: 'Authentication policy saved.' });
      setForm(null);
      qc.invalidateQueries({ queryKey: ['authPolicy'] });
    },
    onError: (err) => setNotice({ ok: false, msg: err?.message || 'Could not save the policy' }),
  });

  const addProvider = useMutation({
    mutationFn: (payload) => api.authPolicy.registerProvider(payload),
    onSuccess: () => {
      setNotice({ ok: true, msg: 'SSO provider registered.' });
      setProvider({ kind: 'oidc', provider_id: '', label: '', domain: '', issuer: '', client_id: '', client_secret: '' });
      qc.invalidateQueries({ queryKey: ['authPolicy'] });
    },
    onError: (err) => setNotice({ ok: false, msg: err?.message || 'Could not register the provider' }),
  });

  const removeProvider = useMutation({
    mutationFn: (id) => api.authPolicy.removeProvider(id),
    onSuccess: () => { setNotice({ ok: true, msg: 'SSO provider removed.' }); qc.invalidateQueries({ queryKey: ['authPolicy'] }); },
    onError: (err) => setNotice({ ok: false, msg: err?.message || 'Could not remove the provider' }),
  });

  if (isLoading) return <p className="text-slate-500">Loading authentication policy…</p>;
  if (!config) return <Alert className="border-red-200 bg-red-50"><AlertDescription className="text-red-900">Could not load the authentication policy.</AlertDescription></Alert>;

  const modes = data?.mfa_modes || [];
  const providers = config.providers || [];
  const domainsText = (config.local_account_domains || []).join(', ');

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-teal-600" /> Multi-factor authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <Label className="mb-2 block text-sm">MFA mode</Label>
              <Select value={config.mfa_mode} onValueChange={(v) => setField('mfa_mode', v)} data-testid="auth-policy-mfa-mode">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modes.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-slate-500">{modes.find((m) => m.key === config.mfa_mode)?.description}</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4">
              <div>
                <p className="text-sm font-medium text-slate-800">Enforce MFA at sign-in</p>
                <p className="text-xs text-slate-500">When on, an admin without a second factor is refused protected routes.</p>
              </div>
              <Switch
                data-testid="auth-policy-enforce-mfa"
                checked={Boolean(config.enforce_mfa)}
                onCheckedChange={(v) => setField('enforce_mfa', v)}
              />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Your account</p>
            <p className="mt-1 text-sm text-slate-700" data-testid="auth-policy-viewer">
              {data?.viewer?.has_mfa ? 'An authenticator app is enrolled.' : 'No second factor is enrolled.'}
              {data?.viewer?.mfa_required ? ' Multi-factor authentication is required for your roles.' : ''}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-teal-600" /> Local account domains
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <div>
            <Label className="mb-2 block text-sm">Approved domains (comma separated)</Label>
            <Input
              data-testid="auth-policy-domains"
              value={domainsText}
              onChange={(e) => setField('local_account_domains', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              placeholder="sirius.local, infinia.local"
            />
            <p className="mt-1 text-xs text-slate-500">Domains permitted to hold a local password account; all others should use SSO.</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4">
            <div>
              <p className="text-sm font-medium text-slate-800">Enforce the allowlist</p>
              <p className="text-xs text-slate-500">When on, an unlisted domain cannot use email and password.</p>
            </div>
            <Switch
              data-testid="auth-policy-enforce-domains"
              checked={Boolean(config.enforce_local_domain_allowlist)}
              onCheckedChange={(v) => setField('enforce_local_domain_allowlist', v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-teal-600" /> SSO providers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-6 text-center text-slate-500">No SSO providers registered.</TableCell></TableRow>
              ) : providers.map((p) => (
                <TableRow key={p.provider_id} data-testid="sso-provider-row">
                  <TableCell className="font-medium text-slate-800">{p.label || p.provider_id}</TableCell>
                  <TableCell><Badge variant="outline">{p.kind}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{p.domain}</TableCell>
                  <TableCell><Badge className={p.source === 'env' ? 'bg-slate-100 text-slate-700' : 'bg-teal-100 text-teal-800'}>{p.source}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" disabled={p.source === 'env'} onClick={() => removeProvider.mutate(p.provider_id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Separator />
          <div className="grid gap-3 md:grid-cols-3">
            <Input placeholder="provider id" value={provider.provider_id} onChange={(e) => setProvider({ ...provider, provider_id: e.target.value })} data-testid="sso-provider-id" />
            <Input placeholder="domain (e.g. sirius.local)" value={provider.domain} onChange={(e) => setProvider({ ...provider, domain: e.target.value })} />
            <Select value={provider.kind} onValueChange={(v) => setProvider({ ...provider, kind: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="oidc">OIDC</SelectItem>
                <SelectItem value="saml">SAML</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="issuer URL (https://idp.example.com)" value={provider.issuer} onChange={(e) => setProvider({ ...provider, issuer: e.target.value })} />
            {provider.kind === 'oidc' ? (
              <>
                <Input placeholder="client id" value={provider.client_id} onChange={(e) => setProvider({ ...provider, client_id: e.target.value })} />
                <Input placeholder="client secret" type="password" value={provider.client_secret} onChange={(e) => setProvider({ ...provider, client_secret: e.target.value })} />
              </>
            ) : (
              <>
                <Input placeholder="IdP entry point (SSO URL)" value={provider.entry_point || ''} onChange={(e) => setProvider({ ...provider, entry_point: e.target.value })} />
                <Input placeholder="IdP signing certificate" value={provider.cert || ''} onChange={(e) => setProvider({ ...provider, cert: e.target.value })} />
              </>
            )}
          </div>
          <Button
            data-testid="sso-add-provider"
            disabled={addProvider.isPending || !provider.provider_id || !provider.domain}
            onClick={() => addProvider.mutate(provider)}
          >
            <Plus className="mr-2 h-4 w-4" /> Register provider
          </Button>
        </CardContent>
      </Card>

      {notice && (
        <Alert className={notice.ok ? 'border-teal-200 bg-teal-50' : 'border-red-200 bg-red-50'}>
          {notice.ok ? <CheckCircle2 className="h-4 w-4 text-teal-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
          <AlertDescription className={notice.ok ? 'text-teal-900' : 'text-red-900'}>{notice.msg}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button data-testid="auth-policy-save" disabled={save.isPending || !form} onClick={() => save.mutate(config)}>
          Save policy
        </Button>
      </div>
      <p className="text-xs text-slate-500">{data?.disclaimer}</p>
    </div>
  );
}


function RolePicker({ roles, value, onChange, disabled }) {
  const toggle = (key) => {
    if (disabled) return;
    onChange(value.includes(key) ? value.filter((r) => r !== key) : [...value, key]);
  };
  return (
    <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
      {roles.map((r) => (
        <label
          key={r.key}
          className={'flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-50 ' + (disabled ? 'opacity-60' : '')}
        >
          <Checkbox checked={value.includes(r.key)} onCheckedChange={() => toggle(r.key)} disabled={disabled} />
          <span className="text-sm text-slate-800">{r.label}</span>
          <span className="font-mono text-[10px] text-slate-400">{r.key}</span>
          {r.admin && <Badge className="ml-auto bg-purple-100 text-[10px] text-purple-800">super</Badge>}
          {r.cross_org && !r.admin && <Badge variant="outline" className="ml-auto text-[10px]">cross-org</Badge>}
        </label>
      ))}
    </div>
  );
}

export default function SuperAdmin() {
  const { user: currentUser } = useAuth();
  const isAdmin = (currentUser?.roles || []).includes('admin') || currentUser?.role === 'admin';

  const { data: rolesData } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.admin.roles(),
    enabled: isAdmin,
  });
  const roles = rolesData?.roles || [];

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="mx-auto max-w-4xl">
          <Alert className="border-amber-200 bg-amber-50">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-900">
              <strong>Access denied.</strong> The super-admin console is only available to accounts holding the
              <span className="mx-1 font-mono text-xs">admin</span> role.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 shadow-md">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Super Admin Console</h1>
            <p className="text-slate-600">Users, tenancy mapping, RBAC roles and access governance</p>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="flex-wrap bg-white border border-slate-200">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Users
            </TabsTrigger>
            <TabsTrigger value="tenancy" className="flex items-center gap-2">
              <Network className="h-4 w-4" /> Tenancy Map
            </TabsTrigger>
            <TabsTrigger value="grants" className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Access Grants
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-2">
              <Activity className="h-4 w-4" /> Audit
            </TabsTrigger>
            <TabsTrigger value="sample" className="flex items-center gap-2">
              <Database className="h-4 w-4" /> Sample Data
            </TabsTrigger>
            <TabsTrigger value="security" className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Security &amp; SSO
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview"><OverviewTab /></TabsContent>
          <TabsContent value="users"><UsersTab roles={roles} /></TabsContent>
          <TabsContent value="tenancy"><TenancyTab roles={roles} /></TabsContent>
          <TabsContent value="grants"><GrantsTab /></TabsContent>
          <TabsContent value="audit"><AuditTab /></TabsContent>
          <TabsContent value="sample"><SampleDataTab /></TabsContent>
          <TabsContent value="security"><SecurityTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.admin.overview(),
  });
  const counts = data?.counts || {};
  const roleDist = data?.role_distribution || [];
  const recent = data?.recent_activity || [];
  const maxRole = Math.max(1, ...roleDist.map((r) => r.n));

  if (isLoading) return <p className="text-slate-500">Loading console…</p>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Users" value={counts.users} hint={counts.active_sessions + ' active session(s)'} />
        <StatCard icon={Building2} label="Tenants (orgs)" value={counts.organizations} hint={counts.auth_tenants + ' mirrored to Better Auth'} />
        <StatCard icon={Network} label="Memberships" value={counts.memberships} hint="user × org role mappings" />
        <StatCard icon={Link2} label="Access Grants" value={counts.access_grants} hint="cross-org exceptions" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4 text-teal-600" /> Role distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {roleDist.length === 0 && <p className="text-sm text-slate-500">No roles assigned yet.</p>}
            {roleDist.map((r) => (
              <div key={r.role} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <Badge className={ROLE_BADGE(r.role)}>{r.role}</Badge>
                  <span className="font-medium text-slate-700">{r.n}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-teal-500" style={{ width: Math.round((r.n / maxRole) * 100) + '%' }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-teal-600" /> Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[420px] divide-y divide-slate-100 overflow-auto">
              {recent.length === 0 && <p className="p-6 text-sm text-slate-500">No activity yet.</p>}
              {recent.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-6 py-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800">
                      <span className="font-medium">{e.actor_email || 'system'}</span>{' '}
                      <span className="text-slate-500">{e.action}</span>{' '}
                      <span className="font-mono text-xs text-slate-500">{e.entity}{e.entity_id ? ':' + e.entity_id : ''}</span>
                    </p>
                    {e.comment && <p className="truncate text-xs text-slate-500">{e.comment}</p>}
                  </div>
                  <span className="whitespace-nowrap text-xs text-slate-400">{new Date(e.ts).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function useOrgs() {
  return useQuery({ queryKey: ['admin', 'organizations'], queryFn: () => api.admin.organizations() });
}

function CreateUserDialog({ roles, onDone }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', org_id: '', roleList: [], can_sign: false, is_primary: true });
  const [error, setError] = useState(null);
  const { data: orgs = [] } = useOrgs();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (payload) => api.admin.createUser(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      qc.invalidateQueries({ queryKey: ['admin', 'tenancy'] });
      setOpen(false);
      setForm({ full_name: '', email: '', phone: '', password: '', org_id: '', roleList: [], can_sign: false, is_primary: true });
      setError(null);
      onDone?.();
    },
    onError: (e) => setError(e.message),
  });

  const submit = () => {
    if (!form.full_name || !form.email) return setError('Name and email are required.');
    if (form.roleList.length && !form.org_id) return setError('Pick an organisation before assigning roles.');
    setError(null);
    create.mutate({
      full_name: form.full_name,
      email: form.email,
      phone: form.phone || undefined,
      password: form.password || undefined,
      org_id: form.org_id || undefined,
      roles: form.roleList,
      can_sign: form.can_sign,
      is_primary: form.is_primary,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-600 hover:bg-teal-700">
          <Plus className="mr-2 h-4 w-4" /> New user
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            Creates the app user, a Better Auth sign-in identity and (optionally) their first organisation role mapping.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Jane Doe" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.local" />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+9715..." />
            </div>
            <div className="space-y-2">
              <Label>
                Password <span className="text-xs font-normal text-slate-400">(blank = deployment default)</span>
              </Label>
              <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="DealForge!2026" />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Tenant (organisation)</Label>
            <Select value={form.org_id} onValueChange={(v) => setForm({ ...form, org_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select an organisation" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Roles</Label>
            <RolePicker roles={roles} value={form.roleList} onChange={(v) => setForm({ ...form, roleList: v })} />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.can_sign} onCheckedChange={(v) => setForm({ ...form, can_sign: v })} />
              Can sign
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.is_primary} onCheckedChange={(v) => setForm({ ...form, is_primary: v })} />
              Primary membership
            </label>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={submit} disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create user'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManageUserDialog({ user, roles, orgs, onClose }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('profile');
  const [profile, setProfile] = useState({
    full_name: user.full_name || '',
    email: user.email || '',
    phone: user.phone || '',
  });
  const [password, setPassword] = useState('');
  const [newMember, setNewMember] = useState({ org_id: '', roleList: [], can_sign: false, is_primary: false });
  const [editingMember, setEditingMember] = useState(null);
  const [editRoleList, setEditRoleList] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tenancy'] });
  };
  const onError = (e) => { setError(e.message); setNotice(null); };
  const onOk = (msg) => { setNotice(msg); setError(null); refresh(); };

  const saveProfile = useMutation({
    mutationFn: () => api.admin.updateUser(user.id, profile),
    onSuccess: () => onOk('Profile updated.'),
    onError,
  });
  const resetPassword = useMutation({
    mutationFn: () => api.admin.setPassword(user.id, password),
    onSuccess: (r) => { setPassword(''); onOk('Password set. ' + (r.revoked_sessions || 0) + ' session(s) revoked.'); },
    onError,
  });
  const toggleBan = useMutation({
    mutationFn: () => api.admin.banUser(user.id, { banned: !user.banned, reason: user.banned ? undefined : 'Disabled by super admin' }),
    onSuccess: () => onOk(user.banned ? 'User unbanned.' : 'User banned and sessions revoked.'),
    onError,
  });
  const deactivate = useMutation({
    mutationFn: () => api.admin.deactivateUser(user.id),
    onSuccess: (r) => onOk('User deactivated. ' + (r?.revoked_sessions || 0) + ' session(s) revoked.'),
    onError,
  });
  const reactivate = useMutation({
    mutationFn: () => api.admin.reactivateUser(user.id),
    onSuccess: () => onOk('User reactivated. They must sign in again.'),
    onError,
  });
  const addMembership = useMutation({
    mutationFn: () => api.admin.createMembership({
      user_id: user.id, org_id: newMember.org_id, roles: newMember.roleList,
      can_sign: newMember.can_sign, is_primary: newMember.is_primary,
    }),
    onSuccess: () => { setNewMember({ org_id: '', roleList: [], can_sign: false, is_primary: false }); onOk('Organisation role mapped.'); },
    onError,
  });
  const updateMembership = useMutation({
    mutationFn: () => api.admin.updateMembership(editingMember.id, { roles: editRoleList }),
    onSuccess: () => { setEditingMember(null); onOk('Roles updated.'); },
    onError,
  });
  const removeMembership = useMutation({
    mutationFn: (id) => api.admin.deleteMembership(id),
    onSuccess: () => onOk('Mapping removed.'),
    onError,
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {user.full_name}
            {user.banned && <Badge variant="destructive">banned</Badge>}
            {user.is_active === false && <Badge variant="outline">deactivated</Badge>}
          </DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        {(error || notice) && (
          <Alert variant={error ? 'destructive' : 'default'} className={notice ? 'border-emerald-200 bg-emerald-50' : ''}>
            {error ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            <AlertDescription>{error || notice}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <Badge variant="outline">{user.has_credential ? 'credential set' : 'no credential'}</Badge>
          <Badge variant="outline">{user.active_sessions || 0} active session(s)</Badge>
          {user.memberships?.length ? <Badge variant="outline">{user.memberships.length} org mapping(s)</Badge> : null}
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-2">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="tenancy">Organisation roles</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-4 pt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Full name</Label>
                <Input value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
                Save profile
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="security" className="space-y-5 pt-4">
            <div className="space-y-2">
              <Label>Set / reset password</Label>
              <div className="flex gap-2">
                <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (min 6 chars)" />
                <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => resetPassword.mutate()} disabled={!password || resetPassword.isPending}>
                  <KeyRound className="mr-2 h-4 w-4" /> Set
                </Button>
              </div>
              <p className="text-xs text-slate-500">Resetting the password revokes all of this user&apos;s active sessions.</p>
            </div>
            <Separator />
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4">
              <div>
                <p className="text-sm font-medium text-slate-800">{user.banned ? 'Banned' : 'Active sign-in'}</p>
                <p className="text-xs text-slate-500">Block or restore this user&apos;s ability to sign in.</p>
              </div>
              <Button variant={user.banned ? 'outline' : 'destructive'} onClick={() => toggleBan.mutate()} disabled={toggleBan.isPending}>
                <Ban className="mr-2 h-4 w-4" /> {user.banned ? 'Unban' : 'Ban'}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4">
              <div>
                <p className="text-sm font-medium text-slate-800">Deactivate account</p>
                <p className="text-xs text-slate-500">Soft-disable the account, keeping history and role mappings. Access ends on the next request and live sessions are revoked.</p>
              </div>
              {user.is_active === false ? (
                <Button variant="outline" data-testid="user-reactivate" onClick={() => reactivate.mutate()} disabled={reactivate.isPending}>
                  Reactivate
                </Button>
              ) : (
                <Button variant="outline" data-testid="user-deactivate" onClick={() => deactivate.mutate()} disabled={deactivate.isPending}>
                  Deactivate
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="tenancy" className="space-y-5 pt-4">
            <div className="space-y-2">
              {(user.memberships || []).length === 0 && <p className="text-sm text-slate-500">No organisation mappings.</p>}
              {(user.memberships || []).map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium text-slate-900">
                        <Building2 className="h-4 w-4 text-slate-400" /> {m.org_name}
                        {m.is_primary && <Badge className="bg-teal-100 text-[10px] text-teal-800">primary</Badge>}
                        {m.can_sign && <Badge variant="outline" className="text-[10px]">can sign</Badge>}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(m.roles || []).length === 0
                          ? <span className="text-xs text-slate-400">no roles</span>
                          : (m.roles || []).map((r) => <Badge key={r} className={ROLE_BADGE(r)}>{r}</Badge>)}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => { setEditingMember(m); setEditRoleList(m.roles || []); }}>
                        Edit roles
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => removeMembership.mutate(m.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {editingMember?.id === m.id && (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      <RolePicker roles={roles} value={editRoleList} onChange={setEditRoleList} />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingMember(null)}>Cancel</Button>
                        <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => updateMembership.mutate()}>Save roles</Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-3 rounded-lg bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-800">Map a new organisation</p>
              <Select value={newMember.org_id} onValueChange={(v) => setNewMember({ ...newMember, org_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select organisation" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <RolePicker roles={roles} value={newMember.roleList} onChange={(v) => setNewMember({ ...newMember, roleList: v })} />
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={newMember.can_sign} onCheckedChange={(v) => setNewMember({ ...newMember, can_sign: v })} /> Can sign
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={newMember.is_primary} onCheckedChange={(v) => setNewMember({ ...newMember, is_primary: v })} /> Primary
                </label>
              </div>
              <div className="flex justify-end">
                <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => addMembership.mutate()} disabled={!newMember.org_id || addMembership.isPending}>
                  <Plus className="mr-2 h-4 w-4" /> Add mapping
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab({ roles }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const { data: orgs = [] } = useOrgs();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', q],
    queryFn: () => api.admin.users({ q }),
  });
  const users = data?.users || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email"
            className="pl-9"
          />
        </div>
        <CreateUserDialog roles={roles} />
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Organisation roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sessions</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">Loading users…</TableCell></TableRow>
              )}
              {!isLoading && users.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">No users match.</TableCell></TableRow>
              )}
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium text-slate-900">{u.full_name}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(u.memberships || []).length === 0 && <span className="text-xs text-slate-400">—</span>}
                      {(u.memberships || []).map((m) => (
                        <span key={m.id} className="inline-flex items-center gap-1">
                          {(m.roles || []).map((r) => (
                            <Badge key={r} className={ROLE_BADGE(r)}>{r}</Badge>
                          ))}
                          <span className="text-xs text-slate-500">{m.org_name}</span>
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span data-testid={'user-status-' + u.id}>
                    {u.status === 'banned'
                      ? <Badge variant="destructive">banned</Badge>
                      : u.is_active === false
                        ? <Badge variant="outline">deactivated</Badge>
                        : <Badge className="bg-emerald-100 text-emerald-800">active</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-slate-600">{u.active_sessions || 0}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setSelected(u)}>
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected && (
        <ManageUserDialog
          user={selected}
          roles={roles}
          orgs={orgs}
          onClose={() => { setSelected(null); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); }}
        />
      )}
    </div>
  );
}


function TenancyTab() {
  const [mode, setMode] = useState('org');
  const [orgFilter, setOrgFilter] = useState('all');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'tenancy'],
    queryFn: () => api.admin.tenancyMatrix(),
  });
  const orgs = useMemo(() => data?.orgs || [], [data]);
  const users = useMemo(() => data?.users || [], [data]);

  const orgAssignments = useMemo(() => {
    const map = new Map();
    for (const u of users) {
      for (const a of u.assignments || []) {
        if (!map.has(a.org_id)) map.set(a.org_id, []);
        map.get(a.org_id).push({ ...a, user: u });
      }
    }
    return map;
  }, [users]);

  const visibleOrgs = orgFilter === 'all' ? orgs : orgs.filter((o) => o.id === orgFilter);

  if (isLoading) return <p className="text-slate-500">Loading tenancy map…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            onClick={() => setMode('org')}
            className={mode === 'org' ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white' : 'rounded-md px-3 py-1.5 text-sm font-medium text-slate-600'}
          >
            By organisation
          </button>
          <button
            onClick={() => setMode('user')}
            className={mode === 'user' ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white' : 'rounded-md px-3 py-1.5 text-sm font-medium text-slate-600'}
          >
            By user
          </button>
        </div>
        {mode === 'org' && (
          <Select value={orgFilter} onValueChange={setOrgFilter}>
            <SelectTrigger className="w-72"><SelectValue placeholder="All organisations" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">All organisations</SelectItem>
              {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {mode === 'org' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleOrgs.map((o) => {
            const members = orgAssignments.get(o.id) || [];
            return (
              <Card key={o.id} className="border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-teal-600" />
                      {o.name}
                    </span>
                    <Badge variant="outline">{members.length} member(s)</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-4">
                  {members.length === 0 && <p className="text-sm text-slate-500">No users mapped to this organisation.</p>}
                  {members.map((m) => (
                    <div key={m.membership_id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {m.user.full_name}
                          {m.is_primary && <span className="ml-2 text-xs text-teal-600">primary</span>}
                          {m.has_grant && <span className="ml-2 text-xs text-amber-600">grant</span>}
                        </p>
                        <p className="truncate text-xs text-slate-500">{m.user.email}</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {(m.roles || []).length === 0
                          ? <span className="text-xs text-slate-400">no role</span>
                          : m.roles.map((r) => <Badge key={r} className={ROLE_BADGE(r)}>{r}</Badge>)}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {mode === 'user' && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Tenancy / role assignments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 && (
                  <TableRow><TableCell colSpan={2} className="py-8 text-center text-slate-500">No users.</TableCell></TableRow>
                )}
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="align-top">
                      <div className="font-medium text-slate-900">{u.full_name}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        {(u.assignments || []).length === 0 && <span className="text-xs text-slate-400">No organisation mapping.</span>}
                        {(u.assignments || []).map((a) => (
                          <div key={a.membership_id} className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-slate-700">{a.org_name}</span>
                            {a.is_primary && <Badge variant="outline" className="text-teal-700">primary</Badge>}
                            {a.has_grant && <Badge variant="outline" className="text-amber-700">cross-org grant</Badge>}
                            {(a.roles || []).map((r) => <Badge key={r} className={ROLE_BADGE(r)}>{r}</Badge>)}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


function GrantsTab() {
  const qc = useQueryClient();
  const { data: grants = [], isLoading } = useQuery({
    queryKey: ['admin', 'grants'],
    queryFn: () => api.admin.accessGrants(),
  });
  const { data: usersData } = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.admin.users() });
  const { data: orgs = [] } = useOrgs();
  const users = usersData?.users || [];
  const [form, setForm] = useState({ user_id: '', org_id: '', scope: 'read', reason: '' });
  const [error, setError] = useState(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'grants'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tenancy'] });
    qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };
  const create = useMutation({
    mutationFn: () => api.admin.createAccessGrant(form),
    onSuccess: () => { setForm({ user_id: '', org_id: '', scope: 'read', reason: '' }); setError(null); invalidate(); },
    onError: (e) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id) => api.admin.deleteAccessGrant(id),
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });

  return (
    <div className="space-y-5">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="text-base">Grant cross-organisation access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>User</Label>
              <Select value={form.user_id} onValueChange={(v) => setForm({ ...form, user_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name} — {u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Organisation</Label>
              <Select value={form.org_id} onValueChange={(v) => setForm({ ...form, org_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select organisation" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">read</SelectItem>
                  <SelectItem value="write">write</SelectItem>
                  <SelectItem value="sign">sign</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why is this access needed?" />
            </div>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end">
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => create.mutate()}
              disabled={!form.user_id || !form.org_id || create.isPending}
            >
              <Plus className="mr-2 h-4 w-4" /> Add grant
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="text-base">Active grants ({grants.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">Loading grants…</TableCell></TableRow>}
              {!isLoading && grants.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">No cross-org grants.</TableCell></TableRow>
              )}
              {grants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <div className="font-medium text-slate-900">{g.full_name}</div>
                    <div className="text-xs text-slate-500">{g.email}</div>
                  </TableCell>
                  <TableCell className="text-slate-700">{g.org_name || '—'}</TableCell>
                  <TableCell><Badge variant="outline">{g.scope}</Badge></TableCell>
                  <TableCell className="max-w-xs truncate text-slate-600">{g.reason || '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => remove.mutate(g.id)} disabled={remove.isPending}>
                      <Trash2 className="mr-2 h-4 w-4" /> Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AuditTab() {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.admin.audit(100),
  });

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-teal-600" /> Identity & access audit trail
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">Loading audit…</TableCell></TableRow>}
            {!isLoading && events.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">No audit events yet.</TableCell></TableRow>
            )}
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-xs text-slate-500">{new Date(e.ts).toLocaleString()}</TableCell>
                <TableCell className="text-slate-700">{e.actor_email || 'system'}</TableCell>
                <TableCell><Badge variant="outline">{e.action}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-slate-500">{e.entity}{e.entity_id ? ':' + e.entity_id : ''}</TableCell>
                <TableCell className="max-w-md truncate text-slate-600">{e.comment || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
