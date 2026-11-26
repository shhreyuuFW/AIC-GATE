import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Layers, Link2, Send, ShieldCheck } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  ServiceBadge,
  StatusBadge,
} from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type { AccessRequestItem, CatalogResourceItem } from "../../types/api";

export function ClientOverviewPage() {
  const [catalog, setCatalog] = useState<CatalogResourceItem[]>([]);
  const [selectedResource, setSelectedResource] =
    useState<CatalogResourceItem | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [reason, setReason] = useState("");

  const [requests, setRequests] = useState<AccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const selectCatalogItem = (item: CatalogResourceItem) => {
    setSelectedResource(item);
    setActions([...item.allowed_actions]);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, reqRes] = await Promise.all([
        api.getCatalog(),
        api.listMyRequests(),
      ]);
      setCatalog(catRes.resources);
      setRequests(reqRes.requests);
      setSelectedResource((prev) => {
        if (prev) {
          return (
            catRes.resources.find((r) => r.resource_id === prev.resource_id) ||
            catRes.resources[0] ||
            null
          );
        }
        const first = catRes.resources[0] || null;
        if (first) setActions([...first.allowed_actions]);
        return first;
      });
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Failed to load catalog",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleAction = (action: string) => {
    setActions((prev) =>
      prev.includes(action)
        ? prev.filter((item) => item !== action)
        : [...prev, action]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedResource) return;
    if (!actions.length) {
      setNotice({
        message: "Select at least one permitted action.",
        tone: "error",
      });
      return;
    }

    setNotice(null);
    setSubmitting(true);
    try {
      const created = await api.submitRequest({
        resource_id: selectedResource.resource_id,
        actions,
        duration_minutes: durationMinutes,
        reason: reason.trim(),
      });
      setReason("");
      setNotice({
        message: `REQUEST ${created.request_id.slice(0, 8)} SUBMITTED // AWAITING COMMANDER APPROVAL`,
        tone: "success",
      });
      await loadData();
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Request rejected",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalLayout
      portal="client"
      eyebrow="OPERATOR PORTAL // APPROVED RESOURCE CATALOG"
      title="Request Scoped AWS Access"
      description="Choose an approved lab service below. Internal ARNs and IAM policies are compiled server-side and audited by Commanders."
      onRefresh={loadData}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Catalog Selector */}
        <ReticleCard
          className="lg:col-span-7"
          tag="APPROVED CATALOG // ZERO ARN EXPOSURE"
          title="Select AWS Resource"
          subtitle="Interconnected services share diagnostic context across S3, DynamoDB, CloudWatch Logs, and SSM."
          action={<Layers className="h-4 w-4 text-[var(--accent-cyan)]" />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {catalog.map((item) => {
              const isSelected =
                selectedResource?.resource_id === item.resource_id;
              return (
                <button
                  key={item.resource_id}
                  type="button"
                  onClick={() => selectCatalogItem(item)}
                  className={`border p-4 text-left transition ${
                    isSelected
                      ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan-soft)]"
                      : "border-[var(--border-hair)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <ServiceBadge service={item.service} />
                    <span className="font-mono-tech text-[10px] text-[var(--text-muted)] uppercase">
                      {item.environment}
                    </span>
                  </div>
                  <div className="text-sm font-bold">{item.label}</div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {item.description}
                  </p>
                </button>
              );
            })}
          </div>

          {selectedResource &&
            selectedResource.related_resource_ids.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-hair)] pt-3">
                <span className="font-mono-tech inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase">
                  <Link2 className="h-3 w-3" /> RELATED SERVICES:
                </span>
                {selectedResource.related_resource_ids.map((relId) => {
                  const target = catalog.find((c) => c.resource_id === relId);
                  if (!target) return null;
                  return (
                    <button
                      key={relId}
                      type="button"
                      onClick={() => selectCatalogItem(target)}
                      className="font-mono-tech border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[10px] hover:border-[var(--accent-cyan)]"
                    >
                      → {target.label}
                    </button>
                  );
                })}
              </div>
            )}
        </ReticleCard>

        {/* Minimal Request Form */}
        <ReticleCard
          className="lg:col-span-5"
          tag="JUST-IN-TIME GRANT"
          title={selectedResource ? selectedResource.label : "Request Details"}
          subtitle={
            selectedResource
              ? `Scope: ${selectedResource.default_scope}`
              : "Select a catalog resource"
          }
        >
          {selectedResource && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <span className="font-mono-tech mb-1.5 block text-[11px] font-semibold uppercase">
                  Permitted Actions
                </span>
                <div className="grid gap-1.5">
                  {selectedResource.allowed_actions.map((action) => (
                    <label
                      key={action}
                      className="flex cursor-pointer items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={actions.includes(action)}
                        onChange={() => toggleAction(action)}
                        className="accent-[var(--accent-cyan)]"
                      />
                      <span className="font-mono-tech">{action}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="duration"
                  className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
                >
                  Duration (15–60 Min)
                </label>
                <select
                  id="duration"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                >
                  <option value={15}>15 MINUTES</option>
                  <option value={30}>30 MINUTES</option>
                  <option value={45}>45 MINUTES</option>
                  <option value={60}>60 MINUTES</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="reason"
                  className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
                >
                  Justification
                </label>
                <textarea
                  id="reason"
                  rows={2}
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Triage incident #402"
                  required
                  className="w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="endfield-chamfer font-mono-tech flex w-full items-center justify-center gap-2 bg-[var(--accent-volt)] px-4 py-2.5 text-xs font-bold tracking-wider text-[var(--accent-volt-ink)] uppercase hover:bg-[var(--accent-volt-hover)] disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {submitting ? "TRANSMITTING..." : "SUBMIT REQUEST"}
              </button>

              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--accent-green)]" />
                <span>
                  Least-privilege IAM session policy is compiled on approval.
                </span>
              </div>
            </form>
          )}
        </ReticleCard>
      </div>

      {/* Compact Requests Table */}
      <ReticleCard
        tag="OPERATOR LOG // SUBMITTED REQUESTS"
        title="My Access Requests"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="font-mono-tech border-b border-[var(--border-hair)] text-[10px] tracking-wider text-[var(--text-muted)] uppercase">
                <th className="px-3 py-2.5">Request</th>
                <th className="px-3 py-2.5">Service</th>
                <th className="px-3 py-2.5">Actions</th>
                <th className="px-3 py-2.5">TTL</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    LOADING REQUESTS...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    NO REQUESTS SUBMITTED YET.
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr
                    key={req.request_id}
                    className="border-b border-[var(--border-hair)]/60 hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="font-mono-tech px-3 py-3 text-[var(--accent-cyan)]">
                      {req.request_id.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-3">
                      <ServiceBadge service={req.service} />
                    </td>
                    <td className="font-mono-tech px-3 py-3">
                      {req.actions.join(", ")}
                    </td>
                    <td className="font-mono-tech px-3 py-3">
                      {req.duration_minutes}m
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="font-mono-tech px-3 py-3 text-[var(--text-muted)]">
                      {new Date(req.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </ReticleCard>
    </PortalLayout>
  );
}
