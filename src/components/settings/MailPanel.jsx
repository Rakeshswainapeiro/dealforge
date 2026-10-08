/* eslint-disable react/prop-types */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Send } from "lucide-react";

// Outbound email (NTF-01). The SMTP relay is configured on the server
// (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM) so no credential is
// ever stored in the database or sent to a browser. This screen shows the
// relay in use and lets an administrator send a test message.
export default function MailPanel({ isAdmin }) {
  const [to, setTo] = useState("");
  const status = useQuery({ queryKey: ["mail-status"], queryFn: () => api.integrations.mailStatus(), enabled: isAdmin, retry: false });
  const test = useMutation({ mutationFn: () => api.integrations.Core.SendEmail({ to, subject: "DealForge test message", body: "This is a test message from DealForge. Mail delivery is working." }) });
  const s = status.data;
  return (
    <Card className="border-slate-200 shadow-sm" data-testid="mail-panel">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-blue-600" /> Email delivery</CardTitle>
        <CardDescription>Notifications are sent in-app and by email through the SMTP relay Sirius designates. The relay is set on the server, not here.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        {!isAdmin ? <p className="text-sm text-slate-600">Only an administrator can view the mail relay.</p> : status.isLoading ? (
          <p className="text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading...</p>
        ) : s ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Mode</dt><dd><Badge variant="outline">{s.mode === "smtp" ? "Sending via SMTP" : "Log only (nothing is sent)"}</Badge></dd></div>
            <div><dt className="text-xs text-slate-500">Relay</dt><dd>{s.host ? `${s.host}:${s.port}${s.secure ? " (TLS)" : " (STARTTLS)"}` : "Not configured"}</dd></div>
            <div><dt className="text-xs text-slate-500">From</dt><dd>{s.from}</dd></div>
            <div><dt className="text-xs text-slate-500">Authenticated</dt><dd>{s.authenticated ? "Yes" : "No"}</dd></div>
          </dl>
        ) : <p className="text-sm text-red-700">{status.error?.message}</p>}
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-sm" type="email" placeholder="you@sirius.ae" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button className="gap-2" disabled={!to || test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test
            </Button>
            {test.data && <span className="self-center text-sm text-slate-600">{test.data.delivered ? "Sent." : `Not sent: ${test.data.detail}`}</span>}
            {test.isError && <span className="self-center text-sm text-red-700">{test.error?.message}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
