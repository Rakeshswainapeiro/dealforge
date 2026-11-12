/* eslint-disable react/prop-types */
import { CheckCircle2, AlertTriangle, XCircle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EXTRA_HEADER_ROWS, LABEL_OVERRIDES, displayValue, formatWhen, headlineText, isLongText, isStructuredKey, numberText,
} from "./reviewModel";

// Read-only views of one submitted section. Every row comes from the stored
// record or the server's evaluated gate; empty values are left out and nothing is
// inferred. There are no inputs anywhere in this file.

const STATUS = {
  pass: { cls: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2, label: "Pass" },
  clear: { cls: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2, label: "Clear" },
  flag: { cls: "bg-amber-50 text-amber-700", Icon: AlertTriangle, label: "To confirm" },
  fail: { cls: "bg-red-50 text-red-700", Icon: XCircle, label: "Failed" },
  flagged: { cls: "bg-red-50 text-red-700", Icon: XCircle, label: "Raised" },
  not_evaluated: { cls: "bg-slate-100 text-slate-600", Icon: AlertTriangle, label: "Not evaluated" },
};

function Chip({ status, text }) {
  const s = STATUS[status] || STATUS.not_evaluated;
  return <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium", s.cls)}>{text || s.label}</span>;
}

export function Card({ title, children, testid }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm" data-testid={testid}>
      {title && <h2 className="mb-4 text-xl font-semibold text-slate-900">{title}</h2>}
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function SubHeading({ children }) {
  return <h3 className="text-sm font-semibold text-slate-900">{children}</h3>;
}

function Row({ label, children, long = false }) {
  return (
    <div className={cn("grid gap-x-6 gap-y-1 border-b border-slate-100 pb-3 last:border-0 last:pb-0", "sm:grid-cols-[220px_minmax(0,1fr)]")}>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={cn("text-sm text-slate-900", long ? "whitespace-pre-wrap leading-relaxed" : "")}>{children}</dd>
    </div>
  );
}

// Plain label/value rows for the fields of the given sections.
function FieldRows({ groups, record, sectionKeys, skipKeys = [], extraRows = [] }) {
  const rows = [];
  for (const group of groups.filter((g) => sectionKeys.includes(g.key))) {
    for (const field of group.fields || []) {
      if (isStructuredKey(field.key) || skipKeys.includes(field.key)) continue;
      const text = displayValue(field, record[field.key]);
      if (text === null) continue;
      rows.push({ key: field.key, label: LABEL_OVERRIDES[field.key] || field.label, text, long: isLongText(field, text) });
    }
  }
  for (const extra of extraRows) {
    const text = displayValue(null, record[extra.key]);
    if (text !== null) rows.push({ key: "extra-" + extra.key, label: extra.label, text, long: false });
  }
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing was entered in this section.</p>;
  return (
    <dl className="space-y-3" data-testid="review-rows">
      {rows.map((r) => <Row key={r.key} label={r.label} long={r.long}>{r.text}</Row>)}
    </dl>
  );
}

// --- tables -------------------------------------------------------------

function Table({ head, children }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>{head.map((h, i) => <th key={i} className={cn("px-3 py-2 font-medium", i === 0 ? "text-left" : "text-right")}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

const td = "px-3 py-2 text-right tabular-nums text-slate-800";

function FinancialSummary({ financials }) {
  if (!financials?.applies || !financials.matrix) return null;
  const { periods, period_keys: keys, rows, matrix } = financials;
  const anyValue = rows.some((r) => keys.some((k) => matrix[r.key]?.[k] !== null && matrix[r.key]?.[k] !== undefined));
  if (!anyValue) return null;
  return (
    <div className="space-y-2" data-testid="review-financial-summary">
      <SubHeading>Financial summary (AED mn)</SubHeading>
      <Table head={["Metric", ...periods]}>
        {rows.map((r) => (
          <tr key={r.key} className={r.kind === "derived" ? "bg-slate-50/50 text-slate-500" : ""}>
            <td className="px-3 py-2 text-left">{r.label}</td>
            {keys.map((k) => <td key={k} className={td}>{numberText(matrix[r.key]?.[k], r.decimals ?? 1)}</td>)}
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ReturnsAndHurdles({ gate }) {
  const rm = gate?.return_metrics;
  const ht = gate?.hurdle_table;
  if (!rm?.applies && !ht?.applies) return null;
  const order = ht?.scenarios || ["base", "upside", "downside"];
  return (
    <div className="space-y-4">
      {ht?.applies && ht.rows?.some((r) => order.some((s) => r.scenarios?.[s]?.present)) && (
        <div className="space-y-2" data-testid="review-hurdles">
          <SubHeading>Returns against the hurdles</SubHeading>
          <Table head={["Hurdle", "Threshold", ...order.map((s) => s[0].toUpperCase() + s.slice(1))]}>
            {ht.rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 text-left">{r.label}</td>
                <td className={td}>{r.comparator === "lte" ? "≤ " : "≥ "}{numberText(r.threshold)}{r.unit === "%" ? "%" : ` ${r.unit}`}</td>
                {order.map((s) => {
                  const c = r.scenarios?.[s];
                  return (
                    <td key={s} className={td}>
                      {c?.present ? (
                        <span className={cn("inline-flex items-center gap-1", c.meets === false ? "text-red-700" : "text-emerald-700")}>
                          {numberText(c.value)}{r.unit === "%" ? "%" : ""}
                          {c.meets === false ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        </span>
                      ) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </Table>
          {ht.message && <p className="text-xs text-slate-500">{ht.message}</p>}
        </div>
      )}
      {rm?.scenarios?.base?.metrics?.moic?.present && (
        <div className="space-y-2">
          <SubHeading>MOIC</SubHeading>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {(rm.scenario_order || ["base", "upside", "downside"]).map((s) => {
              const m = rm.scenarios?.[s]?.metrics?.moic;
              return <div key={s}><dt className="text-xs capitalize text-slate-500">{s}</dt><dd>{m?.present ? `${numberText(m.value)}x` : "—"}</dd></div>;
            })}
          </dl>
        </div>
      )}
      {gate?.wacc?.applies && gate.wacc.message && <p className="text-xs text-slate-500" data-testid="review-wacc">{gate.wacc.message}</p>}
    </div>
  );
}

function StatementModel({ model }) {
  if (!model?.applies || !model.attached) return null;
  const names = { profit_and_loss: "P&L", balance_sheet: "Balance sheet", cash_flow_statement: "Cash flow" };
  return (
    <div className="space-y-2" data-testid="review-statement-model">
      <SubHeading>Three-statement model</SubHeading>
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(model.statements || {}).map(([k, present]) => (
          <Chip key={k} status={present ? "pass" : "flag"} text={`${names[k] || k}: ${present ? "present" : "missing"}`} />
        ))}
        <Chip status={model.balance?.balanced === false ? "fail" : model.balance?.checked ? "pass" : "flag"}
          text={model.balance?.balanced === false ? "Does not balance" : model.balance?.checked ? "Balance sheet balances" : "Balance not checked"} />
      </div>
      {model.message && <p className="text-xs text-slate-500">{model.message}</p>}
    </div>
  );
}

function Valuation({ valuation }) {
  if (!valuation?.applies || !valuation.captured) return null;
  const entry = valuation.entry || {};
  const exit = valuation.exit || {};
  const basis = { ev: "Enterprise value", equity: "Equity value" }[entry.basis] || entry.basis;
  const method = {
    trading_comps: "Trading comparables", precedent_transactions: "Precedent transactions", dcf: "Discounted cash flow", asset_based: "Asset-based", other: "Other",
  }[entry.method] || entry.method;
  return (
    <div className="space-y-2" data-testid="review-valuation">
      <SubHeading>Entry valuation and exit</SubHeading>
      <dl className="space-y-3">
        {entry.amount != null && <Row label="Entry valuation (AED mn)">{numberText(entry.amount)}{basis ? ` · ${basis}` : ""}</Row>}
        {entry.multiple != null && <Row label="Entry multiple">{numberText(entry.multiple)}x{method ? ` · ${method}` : ""}</Row>}
        {exit.route && <Row label="Exit route">{exit.route}{exit.timing ? ` · ${exit.timing}` : ""}{exit.multiple != null ? ` · ${numberText(exit.multiple)}x` : ""}</Row>}
      </dl>
      {valuation.comparables?.length > 0 && (
        <Table head={["Comparable", "Metric", "Multiple"]}>
          {valuation.comparables.map((c, i) => (
            <tr key={i}><td className="px-3 py-2 text-left">{c.name}</td><td className={td}>{c.metric}</td><td className={td}>{numberText(c.multiple)}x</td></tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function SourcesUses({ su }) {
  if (!su?.applies || !su.captured) return null;
  const sources = (su.sources || []).filter((s) => s.present);
  const uses = (su.uses || []).filter((u) => u.present);
  return (
    <div className="space-y-2" data-testid="review-sources-uses">
      <SubHeading>Funding sources and uses (AED mn)</SubHeading>
      <div className="grid gap-4 md:grid-cols-2">
        <Table head={["Source", "AED mn", "%", "Status"]}>
          {sources.map((s) => (
            <tr key={s.key}><td className="px-3 py-2 text-left">{s.label}</td><td className={td}>{numberText(s.aed)}</td><td className={td}>{s.pct != null ? numberText(s.pct) : "—"}</td><td className={cn(td, "capitalize")}>{s.status || "—"}</td></tr>
          ))}
          <tr className="bg-slate-50 font-medium"><td className="px-3 py-2 text-left">Total</td><td className={td}>{numberText(su.total_sources)}</td><td className={td} /><td className={td} /></tr>
        </Table>
        <Table head={["Use", "AED mn"]}>
          {uses.map((u) => <tr key={u.key}><td className="px-3 py-2 text-left">{u.label}</td><td className={td}>{numberText(u.aed)}</td></tr>)}
          <tr className="bg-slate-50 font-medium"><td className="px-3 py-2 text-left">Total</td><td className={td}>{numberText(su.total_uses)}</td></tr>
        </Table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip status={su.balanced ? "pass" : "fail"} text={su.balanced ? "Sources equal uses" : `Difference AED ${numberText(su.difference)} mn`} />
        {(su.flags || []).map((f, i) => <Chip key={i} status="flag" text={f.message || f.label || String(f)} />)}
      </div>
    </div>
  );
}

function BudgetLine({ budget }) {
  if (!budget?.applies || !budget.answered) return null;
  return (
    <div className="space-y-2" data-testid="review-budget">
      <SubHeading>Budget status</SubHeading>
      <div className="flex flex-wrap items-center gap-2">
        <Chip status={budget.satisfied ? "pass" : "flag"} text={budget.in_budget ? "In the approved budget" : "Off-budget, variance justified"} />
        {budget.line_reference && <span className="text-sm text-slate-700">Budget line {budget.line_reference}</span>}
      </div>
    </div>
  );
}

function FilterList({ title, items, testid, valueOf }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="space-y-2" data-testid={testid}>
      <SubHeading>{title}</SubHeading>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {items.map((i) => (
          <li key={i.key} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{i.label}</p>
              {i.rationale && <p className="text-xs text-slate-500">{i.rationale}</p>}
            </div>
            {valueOf(i)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RiskScreens({ gate }) {
  const am = gate?.adverse_media;
  return (
    <div className="space-y-5">
      <FilterList title="Gate 1 hard filters" items={gate?.hard_filters?.items} testid="review-hard-filters"
        valueOf={(i) => <Chip status={i.status} />} />
      <FilterList title="Gate 1 soft filters" items={gate?.soft_filters?.items} testid="review-soft-filters"
        valueOf={(i) => <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{i.score}/5 · {i.label_band}</span>} />
      <FilterList title="Automatic disqualifier flags" items={gate?.disqualifiers?.items} testid="review-disqualifiers"
        valueOf={(i) => <Chip status={i.status === "clear" ? "clear" : i.status === "flagged" ? "flagged" : "not_evaluated"} />} />
      {am && am.confirmation && (
        <div className="space-y-2" data-testid="review-adverse-media">
          <SubHeading>Sanctions / adverse-media confirmation</SubHeading>
          <dl className="space-y-3">
            <Row label="Verdict">{<Chip status={am.status === "clear" ? "clear" : "flag"} text={am.status === "clear" ? "Clear" : am.status} />}</Row>
            {am.source && <Row label="Screening source">{am.source}</Row>}
            {am.reviewed_by && <Row label="Screened by">{am.reviewed_by}</Row>}
            {am.evidence_reference && <Row label="Evidence reference">{am.evidence_reference}</Row>}
          </dl>
          {am.message && <p className="text-xs text-slate-500">{am.message}</p>}
        </div>
      )}
    </div>
  );
}

// --- documents ----------------------------------------------------------

export function DocumentsView({ gate, documents }) {
  const all = Array.isArray(documents) ? documents : [];
  const requirements = gate?.documents || [];
  const byKey = new Map();
  for (const d of all) {
    const list = byKey.get(d.requirement_key) || [];
    list.push(d);
    byKey.set(d.requirement_key, list);
  }
  const shown = requirements.filter((r) => r.required || (byKey.get(r.key) || []).length > 0);
  const qa = all.filter((d) => String(d.requirement_key || "").startsWith("qa_attachment:"));
  return (
    <div className="space-y-4" data-testid="review-documents">
      {shown.length === 0 && <p className="text-sm text-slate-500">No documents were uploaded.</p>}
      {shown.map((req) => {
        const versions = (byKey.get(req.key) || []).slice().sort((a, b) => b.version - a.version);
        return (
          <div key={req.key} className="rounded-md border border-slate-200" data-testid={`review-doc-${req.key}`}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{req.label}</p>
                <p className="text-xs text-slate-500">{req.required ? "Mandatory" : "Optional"}</p>
              </div>
              <Chip status={versions.length ? "pass" : "flag"} text={versions.length ? "Provided" : "Missing"} />
            </div>
            {versions.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {versions.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <a className="flex min-w-0 items-center gap-2 text-blue-700 hover:underline" href={d.file_url} title={d.original_name}>
                      <FileText className="h-4 w-4 shrink-0" /><span className="truncate">{d.original_name}</span>
                    </a>
                    <span className="flex items-center gap-2 text-xs text-slate-500">
                      v{d.version} · {formatWhen(d.uploaded_at)} · {d.uploaded_by}
                      <span className={cn("rounded px-1.5 py-0.5", d.is_current ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>{d.is_current ? "Current" : "Superseded"}</span>
                      {d.scan_verdict && <span className="rounded bg-slate-100 px-1.5 py-0.5">Scan: {d.scan_verdict}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {qa.length > 0 && <p className="text-xs text-slate-500">{qa.length} file(s) sent in Q&amp;A threads are kept with those threads.</p>}
    </div>
  );
}

// --- one tab ------------------------------------------------------------

export default function ReviewSections({ tab, groups, record, gate, documents }) {
  if (tab.key === "documents") {
    return <Card title="Documents" testid="review-section-documents"><DocumentsView gate={gate} documents={documents} /></Card>;
  }
  const isFirst = tab.key === "executive_summary";
  const headline = isFirst ? headlineText(record) : null;
  const titleNumber = { executive_summary: "1.", opportunity_overview: "2.", rationale: "3.", financials: "4.", funding: "5.", risks: "6." }[tab.key];

  return (
    <Card title={`${titleNumber} ${tab.label}`} testid={`review-section-${tab.key}`}>
      {headline && (
        <p className="rounded-md bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700" data-testid="review-headline">{headline}</p>
      )}
      <FieldRows groups={groups} record={record} sectionKeys={tab.sections}
        skipKeys={isFirst && headline && record.exec_summary_headline_value ? ["exec_summary_headline_value"] : []}
        extraRows={isFirst ? EXTRA_HEADER_ROWS : []} />
      {tab.key === "financials" && (
        <>
          <FinancialSummary financials={gate?.financials} />
          <StatementModel model={gate?.statement_model} />
          <ReturnsAndHurdles gate={gate} />
          <Valuation valuation={gate?.valuation} />
        </>
      )}
      {tab.key === "funding" && (
        <>
          <SourcesUses su={gate?.sources_uses} />
          <BudgetLine budget={gate?.budget_status} />
        </>
      )}
      {tab.key === "risks" && <RiskScreens gate={gate} />}
    </Card>
  );
}
