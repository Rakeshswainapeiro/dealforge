import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, Download, Printer, Loader2, AlertTriangle, CheckCircle2, Link2, ExternalLink, QrCode, ShieldCheck, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { isPageEnabled } from "@/lib/features";

// ---------------------------------------------------------------------------
// Sirius investment memo preview (REQ-MEMO-01).
//
// Renders the six-page Opportunity Overview the server assembles from the
// opportunity's structured fields, in the Sirius "Part B · Submission
// Template" order. The preview and the downloaded .docx come from the same
// memo model, so what a reviewer approves on screen is what they export.
// ---------------------------------------------------------------------------

function FieldRow({ label, value }) {
  const isEmpty = !value || value === "[ ]";
  return (
    <div className="grid grid-cols-[38%_62%] border-b border-slate-100 last:border-b-0">
      <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">{label}</div>
      <div className={cn("px-3 py-2 text-xs", isEmpty ? "italic text-slate-400" : "text-slate-800")}>
        {isEmpty ? "[ ]" : value}
      </div>
    </div>
  );
}

function Prose({ heading, text, placeholder }) {
  const isEmpty = !text || text.trim() === "" || text.trim() === "[]";
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3">
      <p className="text-sm font-semibold text-slate-800">{heading}</p>
      <p className={cn("mt-1 text-xs", isEmpty ? "italic text-slate-400" : "text-slate-700")}>
        {isEmpty ? placeholder : text}
      </p>
    </div>
  );
}

function SimpleTable({ columns, rows, widths }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-cyan-700 text-white">
            {columns.map((c, i) => (
              <th
                key={`${c}-${i}`}
                className="border-r border-cyan-600 px-2 py-1.5 text-left font-semibold last:border-r-0"
                style={widths ? { width: `${widths[i]}%` } : undefined}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 ? "bg-slate-50/60" : "bg-white"}>
              {row.map((cell, ci) => {
                const isEmpty = cell === "[ ]";
                return (
                  <td
                    key={ci}
                    className={cn(
                      "border-r border-t border-slate-200 px-2 py-1.5 last:border-r-0",
                      isEmpty ? "italic text-slate-400" : "text-slate-700"
                    )}
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ section }) {
  switch (section.type) {
    case "fields":
      return (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-cyan-900">{section.heading}</p>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {section.rows.map((r) => <FieldRow key={r.label} label={r.label} value={r.value} />)}
          </div>
        </div>
      );
    case "prose":
      return <Prose heading={section.heading} text={section.text} placeholder={section.placeholder} />;
    case "bullets":
      return (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-cyan-900">{section.heading}</p>
          <ul className="space-y-1">
            {(section.items || []).map((item, i) => {
              const isEmpty = !item.text || item.text === "[ ]";
              return (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="text-slate-300">•</span>
                  <span className={isEmpty ? "italic text-slate-400" : "text-slate-700"}>
                    {item.label && <span className="font-semibold text-slate-800">{item.label}: </span>}
                    {isEmpty ? "[ ]" : item.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    case "cards":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          {(section.cards || []).map((c) => (
            <div key={c.title} className="rounded-lg border border-slate-200 bg-cyan-50/40 p-3">
              <p className="text-sm font-semibold text-cyan-900">{c.title}</p>
              <p className={cn("mt-1 text-xs", c.text === "[ ]" ? "italic text-slate-400" : "text-slate-700")}>
                {c.text}
              </p>
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="space-y-1.5" data-testid={section.testid || undefined}>
          {section.heading && <p className="text-sm font-semibold text-cyan-900">{section.heading}</p>}
          <SimpleTable columns={section.columns} rows={section.rows} widths={section.widths} />
          {section.note && <p className="text-[11px] italic text-slate-500">{section.note}</p>}
        </div>
      );
    case "finTable":
      return (
        <div className="space-y-1.5" data-testid="memo-fin-table">
          <p className="text-sm font-semibold text-cyan-900">{section.heading}</p>
          <SimpleTable
            columns={[section.unit_label || "AED mn", ...section.periods]}
            rows={section.rows.map((r) => [r.label, ...r.values])}
            widths={[20, ...section.periods.map(() => 10)]}
          />
        </div>
      );
    case "returnsTable":
      return (
        <div data-testid="memo-returns-table">
          <SimpleTable
            columns={["Returns", "Hurdle", "Base", "Upside", "Downside", "Meets?"]}
            rows={section.rows.map((r) => [r.label, r.hurdle, r.base, r.upside, r.downside, r.meets])}
            widths={[16, 30, 12, 12, 14, 12]}
          />
        </div>
      );
    case "keyAsks":
      return (
        <div className="space-y-2">
          <p className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-semibold text-white">{section.heading}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {(section.cards || []).map((c) => (
              <div key={c.number} className="rounded-lg bg-cyan-900 p-3 text-white">
                <p className="text-sm font-bold">{c.number}</p>
                <p className="mt-1 text-xs font-semibold">{c.title}</p>
                <p className="mt-1 text-[11px] text-cyan-100">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      );
    case "fundingTables":
      return (
        <div className="grid gap-3 sm:grid-cols-[3fr_2fr]" data-testid="memo-funding-tables">
          <SimpleTable
            columns={["Funding — sources", "AED mn", "%", "Status"]}
            rows={section.sourceRows.map((r) => [r.label, r.aed, r.pct, r.status])}
            widths={[38, 16, 11, 35]}
          />
          <SimpleTable
            columns={["Uses", "AED mn"]}
            rows={section.useRows.map((r) => [r.label, r.aed])}
            widths={[66, 34]}
          />
        </div>
      );
    case "note":
      return <p className="text-xs text-slate-700">{section.text}</p>;
    default:
      return null;
  }
}

function availabilityMeta(link) {
  if (link.availability === "attached") return { label: "v" + link.version + " attached", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (link.availability === "captured") return { label: "captured", cls: "bg-sky-50 text-sky-700 border-sky-200" };
  if (link.availability === "missing") return { label: "not on record", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: link.availability, cls: "bg-slate-50 text-slate-600 border-slate-200" };
}

// Data-point to source mapping (W5-04 / DOC-05): each memo value traced back to
// the artefact or captured field it came from, so a reviewer can open the source.
function SourceMap({ map }) {
  if (!map || !map.pages?.length) return null;
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4" data-testid="memo-source-map">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-sky-900">
          <Link2 className="h-4 w-4" /> Data-point source map
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-white border-sky-200 text-sky-700">{map.version}</Badge>
          {map.missing?.length > 0 && (
            <Badge variant="outline" className="gap-1 bg-amber-100 text-amber-800 border-amber-200">
              <AlertTriangle className="h-3 w-3" /> {map.missing.length} source(s) not on record
            </Badge>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {map.pages.map((page) => (
          <div key={page.key}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">{page.label}</p>
            <div className="mt-1 overflow-hidden rounded-lg border border-sky-100 bg-white">
              {page.links.map((link) => {
                const meta = availabilityMeta(link);
                return (
                  <div key={link.target} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0" data-testid={"memo-source-" + link.target}>
                    <div className="min-w-[12rem]">
                      <p className="text-xs font-medium text-slate-800">{link.target_label}</p>
                      <p className="text-[11px] text-slate-500">{link.note}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">{link.source_type} · {link.source_ref}</span>
                      <Badge variant="outline" className={cn("text-[10px]", meta.cls)}>{meta.label}</Badge>
                      {link.url && (
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:underline"
                          data-testid={"memo-source-open-" + link.target}
                        >
                          <ExternalLink className="h-3 w-3" /> Open source
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] italic text-slate-500">{map.disclaimer}</p>
    </div>
  );
}

export default function SiriusMemoDialog({ opportunityId, opportunityName, open, onOpenChange }) {
  const [downloading, setDownloading] = useState(false);
  const [packing, setPacking] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [qrUrl, setQrUrl] = useState(null);
  const [verifyError, setVerifyError] = useState(null);
  const { features } = useAuth();
  const packEnabled = isPageEnabled(features || {}, "MemoPack");
  const verifyEnabled = isPageEnabled(features || {}, "MemoVerification");

  const memoQuery = useQuery({
    queryKey: ["pipeline", "memo", opportunityId],
    queryFn: () => api.pipeline.memo(opportunityId),
    enabled: Boolean(open && opportunityId),
  });

  const memo = memoQuery.data;
  const missing = memo?.missing || [];

  const handleDownload = async (format = "docx") => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await api.pipeline.downloadMemo(opportunityId, format);
    } catch (err) {
      setDownloadError(err?.message || "Could not download the memo.");
    } finally {
      setDownloading(false);
    }
  };

  // Export the six-page Opportunity Overview pack (W7-04 / OUT-02). The HTML
  // pack is print-ready: open it and print to PDF, one template page per sheet.
  const handlePack = async () => {
    setPacking(true);
    setDownloadError(null);
    try {
      await api.memoPack.download(opportunityId, "html");
    } catch (err) {
      setDownloadError(err?.message || "Could not export the Opportunity Overview pack.");
    } finally {
      setPacking(false);
    }
  };

  // Issue (or refresh) the signed QR verification payload for this memo
  // (W7-05 / OUT-03). The payload ties the exported copy to the record version
  // and content hash; scanning it opens the public /verify page.
  const handleVerify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const issued = await api.memoVerification.issue(opportunityId);
      setVerification(issued);
      const url = await api.memoVerification.qrObjectUrl(opportunityId, "png");
      setQrUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (err) {
      setVerifyError(err?.message || "Could not issue a verification QR.");
    } finally {
      setVerifying(false);
    }
  };

  // Revoke the QR object URL when the dialog closes so we never leak blobs.
  useEffect(() => {
    if (!open) {
      setQrUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      setVerification(null);
      setVerifyError(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-cyan-700" />
            Sirius investment memo
          </DialogTitle>
          <DialogDescription>
            {memo?.header || opportunityName} · generated on the Sirius Investment Framework
            {" "}Part B template — six pages, AED mn.
          </DialogDescription>
        </DialogHeader>

        {memoQuery.isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Assembling the memo from this opportunity...
          </div>
        ) : memoQuery.isError ? (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-red-900">
              {memoQuery.error?.status === 403
                ? "You do not have permission to view this opportunity."
                : memoQuery.error?.message || "Could not build the memo."}
            </AlertDescription>
          </Alert>
        ) : memo ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-white text-slate-700 border-slate-200">
                  {memo.pages.length} pages
                </Badge>
                <Badge variant="outline" className="bg-white text-slate-700 border-slate-200">
                  {memo.evidence?.present?.length || 0} evidence docs attached
                </Badge>
                {missing.length > 0 && (
                  <Badge variant="outline" className="gap-1 bg-amber-100 text-amber-800 border-amber-200">
                    <AlertTriangle className="h-3 w-3" /> {missing.length} field(s) still on placeholders
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {packEnabled && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 border-cyan-300 text-cyan-800 hover:bg-cyan-50"
                    onClick={handlePack}
                    disabled={packing}
                    data-testid="memo-pack-export"
                  >
                    {packing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                    Export Overview pack
                  </Button>
                )}
                <Button
                  size="sm"
                  className="gap-2 bg-cyan-700 hover:bg-cyan-800"
                  onClick={() => handleDownload("docx")}
                  disabled={downloading}
                >
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Download .docx
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => handleDownload("pdf")}
                  disabled={downloading}
                  data-testid="memo-download-pdf"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
                {verifyEnabled && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 border-slate-300 text-slate-800 hover:bg-slate-50"
                    onClick={handleVerify}
                    disabled={verifying}
                    data-testid="memo-verify-issue"
                  >
                    {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                    Verification QR
                  </Button>
                )}
              </div>
            </div>

            {downloadError && (
              <Alert className="border-red-200 bg-red-50">
                <AlertDescription className="text-red-900">{downloadError}</AlertDescription>
              </Alert>
            )}

            {missing.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5" /> Template fields with no value yet
                </p>
                <p className="mt-1 text-[11px] text-amber-800">
                  These render as the template's grey [ ] placeholder: {missing.map((f) => f.label).join(", ")}
                </p>
              </div>
            )}

            <div className="space-y-5">
              {memo.pages.map((page) => (
                <div key={page.key} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <div>
                      <p className="text-base font-bold text-cyan-900">
                        {page.number}. {page.title}
                      </p>
                      <p className="text-[11px] italic text-slate-500">{page.caption}</p>
                    </div>
                    <span className="text-[11px] font-semibold text-cyan-700">{memo.header}</span>
                  </div>
                  <div className="space-y-4">
                    {page.sections.map((section, i) => <Section key={i} section={section} />)}
                  </div>
                </div>
              ))}
            </div>

            <SourceMap map={memo.source_map} />

            {verifyEnabled && (verification || verifyError) && (
              <div className="rounded-xl border border-slate-200 p-4" data-testid="memo-verify-panel">
                <p className="flex items-center gap-2 text-sm font-bold text-cyan-900">
                  <ShieldCheck className="h-4 w-4" /> QR verification
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  The QR binds this memo to its record version and content hash. A scanned copy opens the public verify page; an edited record or forged QR fails.
                </p>
                {verifyError ? (
                  <Alert className="mt-3 border-red-200 bg-red-50">
                    <AlertDescription className="text-red-900">{verifyError}</AlertDescription>
                  </Alert>
                ) : (
                  <div className="mt-3 flex flex-wrap items-start gap-4">
                    {qrUrl ? (
                      <img
                        src={qrUrl}
                        alt="Memo verification QR"
                        data-testid="memo-verify-qr"
                        className="h-40 w-40 rounded-lg border border-slate-200 bg-white p-1"
                      />
                    ) : (
                      <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-dashed border-slate-300">
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      </div>
                    )}
                    <div className="min-w-[220px] flex-1 space-y-1 text-[11px]">
                      <p className="text-slate-500">Record version</p>
                      <p className="font-mono text-xs text-slate-800" data-testid="memo-verify-version">{verification?.version}</p>
                      <p className="pt-1 text-slate-500">Content hash (sha256)</p>
                      <p className="break-all font-mono text-xs text-slate-800">{verification?.hash}</p>
                      <a
                        href={verification?.verify_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 pt-1 text-cyan-700 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> Open verify page
                      </a>
                      <div className="pt-1">
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={handleVerify} disabled={verifying}>
                          <RefreshCw className="h-3 w-3" /> Refresh hash
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="flex items-center gap-2 text-[11px] text-slate-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              {memo.confidentiality} · source: {memo.source}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
