import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { api } from "@/api/client";
import { SIRIUS_ORGANIZATIONS, SIRIUS_ORG_ROOT_ID } from "@/data/siriusOrgTree";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Building2, ChevronDown, ChevronRight, Landmark, Network, Search } from "lucide-react";

const TYPE_STYLE = {
  platform: "bg-teal-100 text-teal-800 border-teal-200",
  holding: "bg-slate-200 text-slate-800 border-slate-300",
  subsidiary: "bg-slate-100 text-slate-600 border-slate-200",
};

function buildIndex(rows) {
  const byId = new Map();
  rows.forEach((r) => byId.set(r.id, r));
  const childrenOf = new Map();
  const roots = [];
  rows.forEach((r) => {
    if (r.parent_id && byId.has(r.parent_id)) {
      if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
      childrenOf.get(r.parent_id).push(r);
    } else {
      roots.push(r);
    }
  });
  childrenOf.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
  roots.sort((a, b) => (a.id === SIRIUS_ORG_ROOT_ID ? -1 : b.id === SIRIUS_ORG_ROOT_ID ? 1 : a.name.localeCompare(b.name)));
  return { byId, childrenOf, roots };
}

function OrgNode({ node, childrenOf, depth, expanded, toggle, selectedId, onSelect, filter }) {
  const children = childrenOf.get(node.id) || [];
  const isOpen = expanded.has(node.id);
  const matches = !filter || node.name.toLowerCase().includes(filter) ||
    (node.principal_activities || "").toLowerCase().includes(filter);
  const childMatches = filter
    ? (function any(n) { return (childrenOf.get(n.id) || []).some((c) => any(c)); })(node)
    : true;
  if (!matches && !childMatches) return null;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label={node.name}
        className={`group flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
          selectedId === node.id ? "border-teal-300 bg-teal-50" : "border-transparent hover:bg-slate-50"
        }`}
        style={{ marginLeft: depth * 20 }}
        onClick={() => onSelect(node)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node);
          }
        }}
      >
        <button
          type="button"
          className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-700"
          onClick={(e) => {
            e.stopPropagation();
            toggle(node.id);
          }}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          {children.length > 0 ? (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <span className="w-4" />}
        </button>
        <Building2 className={`w-4 h-4 ${node.type === "platform" ? "text-teal-600" : "text-slate-400"}`} />
        <span className={`text-sm ${node.type === "platform" ? "font-bold text-slate-900" : node.type === "holding" ? "font-semibold text-slate-800" : "text-slate-700"}`}>
          {node.name}
        </span>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${TYPE_STYLE[node.type] || TYPE_STYLE.subsidiary}`}>
          {node.type}
        </Badge>
        {node.ownership_pct != null && (
          <span className="text-[11px] text-slate-500">{(Number(node.ownership_pct) * 100).toFixed(2).replace(/\.00$/, "")}%</span>
        )}
        {children.length > 0 && <span className="ml-auto text-[11px] text-slate-400">{children.length}</span>}
      </div>
      {isOpen &&
        children.map((c) => (
          <OrgNode
            key={c.id}
            node={c}
            childrenOf={childrenOf}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            selectedId={selectedId}
            onSelect={onSelect}
            filter={filter}
          />
        ))}
    </div>
  );
}

OrgNode.propTypes = {
  node: PropTypes.object.isRequired,
  childrenOf: PropTypes.instanceOf(Map).isRequired,
  depth: PropTypes.number.isRequired,
  expanded: PropTypes.instanceOf(Set).isRequired,
  toggle: PropTypes.func.isRequired,
  selectedId: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  filter: PropTypes.string,
};

export default function GroupStructure() {
  const [rows, setRows] = useState(SIRIUS_ORGANIZATIONS);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(() => new Set([SIRIUS_ORG_ROOT_ID]));

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await api.entities.Organization.list();
        if (active && stored && stored.length) setRows(stored);
      } catch {
        /* fall back to bundled data */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const { byId, childrenOf, roots } = useMemo(() => buildIndex(rows), [rows]);

  const stats = useMemo(() => {
    const maxLevel = rows.reduce((m, r) => Math.max(m, r.level || 0), 0);
    return {
      total: rows.length,
      holdings: rows.filter((r) => r.type === "holding").length,
      subsidiaries: rows.filter((r) => r.type === "subsidiary").length,
      depth: maxLevel + 1,
    };
  }, [rows]);

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const parentName = selected?.parent_id ? byId.get(selected.parent_id)?.name : null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Network className="w-6 h-6 text-teal-600" />
            Group Structure
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Sirius International Holding Limited — organisation tree from{" "}
            <span className="font-medium">List of Subsdiaries Q2 2026.xlsx</span> (Sirius is the target root for now).
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {[
            ["Entities", stats.total],
            ["Holdings", stats.holdings],
            ["Subsidiaries", stats.subsidiaries],
            ["Levels", stats.depth],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-center shadow-sm">
              <div className="text-lg font-bold text-slate-900">{value}</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 p-3">
            <Search className="w-4 h-4 text-slate-400" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value.toLowerCase())}
              placeholder="Filter by name or activity…"
              className="border-0 shadow-none focus-visible:ring-0"
            />
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-800 shrink-0"
              onClick={() => setExpanded(new Set(rows.map((r) => r.id)))}
            >
              Expand all
            </button>
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-800 shrink-0"
              onClick={() => setExpanded(new Set([SIRIUS_ORG_ROOT_ID]))}
            >
              Collapse
            </button>
          </div>
          <div className="p-3 max-h-[70vh] overflow-auto">
            {roots.map((r) => (
              <OrgNode
                key={r.id}
                node={r}
                childrenOf={childrenOf}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                selectedId={selected?.id}
                onSelect={setSelected}
                filter={filter}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm h-fit lg:sticky lg:top-6">
          {selected ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Landmark className="w-4 h-4 text-teal-600" />
                <Badge variant="outline" className={`text-[10px] ${TYPE_STYLE[selected.type] || TYPE_STYLE.subsidiary}`}>
                  {selected.type}
                </Badge>
              </div>
              <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Ownership (2026)</dt>
                  <dd className="text-slate-800">
                    {selected.ownership_pct != null ? `${(Number(selected.ownership_pct) * 100).toFixed(2)}%` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Parent</dt>
                  <dd className="text-slate-800">{parentName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Geography</dt>
                  <dd className="text-slate-800">{selected.geography || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Level</dt>
                  <dd className="text-slate-800">{selected.level}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Principal activities</dt>
                  <dd className="text-slate-800 leading-relaxed">{selected.principal_activities || "—"}</dd>
                </div>
                {selected.note && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Note</dt>
                    <dd className="text-slate-800">{selected.note}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Direct children</dt>
                  <dd className="text-slate-800">{(childrenOf.get(selected.id) || []).length}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="text-sm text-slate-500">
              Select an entity to see its ownership, parent, geography and activities.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
