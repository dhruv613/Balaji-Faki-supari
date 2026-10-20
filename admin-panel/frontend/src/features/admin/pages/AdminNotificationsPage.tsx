import { useEffect, useState } from 'react';
import Notice from '@shared/components/common/Notice';
import { env } from '@shared/lib/env';
import { getErrorMessage } from '@shared/lib/api';
import { getAdminNotifications, retryFailedNotification } from '../api';
import type {
  AdminNotificationLog,
  NotificationTemplateItem,
  NotificationTriggerEvent,
  EmailDeliveryStatus,
} from '../types';
import {
  SAMPLE_NOTIFICATION_LOGS,
  SAMPLE_NOTIFICATION_TEMPLATES,
} from '../lib/referenceData';
import {
  StatCard,
  StatusBadge,
  DetailDrawer,
  LoadingSkeleton,
  useAdminToast,
} from '../components';

export default function AdminNotificationsPage() {
  const { showToast } = useAdminToast();
  const [logs, setLogs] = useState<AdminNotificationLog[]>(SAMPLE_NOTIFICATION_LOGS);
  const [templates, setTemplates] = useState<NotificationTemplateItem[]>(
    SAMPLE_NOTIFICATION_TEMPLATES,
  );
  const [activeTab, setActiveTab] = useState<'history' | 'templates' | 'settings'>('history');
  const [statusFilter, setStatusFilter] = useState<EmailDeliveryStatus | 'ALL'>('ALL');
  const [triggerFilter, setTriggerFilter] = useState<NotificationTriggerEvent | 'ALL'>('ALL');
  const [selectedTemplate, setSelectedTemplate] = useState<NotificationTemplateItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [loading, setLoading] = useState(Boolean(env.apiBaseUrl));
  const [error, setError] = useState('');
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let active = true;
    if (!env.apiBaseUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    getAdminNotifications({
      trigger: triggerFilter,
      deliveryStatus: statusFilter,
    })
      .then((res) => {
        if (active) {
          setLogs(res.logs);
          setTemplates(res.templates);
          setIsLive(true);
        }
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [triggerFilter, statusFilter]);

  const filteredLogs = logs.filter((log) => {
    if (statusFilter !== 'ALL' && log.deliveryStatus !== statusFilter) return false;
    if (triggerFilter !== 'ALL' && log.trigger !== triggerFilter) return false;
    return true;
  });

  async function handleRetryFailedEmail(log: AdminNotificationLog) {
    if (!env.apiBaseUrl) {
      showToast(
        `Integration pending: FastAPI (POST /api/admin/notifications/${log.id}/retry) is not connected. Email retry requires backend SMTP dispatch.`,
        'warning',
      );
      return;
    }
    setBusyId(log.id);
    try {
      const updated = await retryFailedNotification(log.id);
      setLogs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      showToast(`Retried email delivery for ${updated.orderNumber}.`, 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Customer Notifications</h1>
          <p className="page__subtitle">
            Transactional email and in-website order status notifications dispatched post-commit.
          </p>
        </div>
        <div className="admin-action-group">
          <span className="badge badge--green">Email &amp; In-Website Active</span>
          <span className="badge badge--outline">WhatsApp: Future Phase Prepared</span>
        </div>
      </div>

      <Notice title="Post-Commit Transactional Dispatch Policy">
        All customer notifications are dispatched strictly <strong>after</strong> the relevant PostgreSQL database transaction commits in FastAPI. Uncommitted or rolled-back state changes never trigger customer emails.
      </Notice>

      {!isLive && (
        <Notice tone="info" title="Development reference examples">
          FastAPI (<code>/api/admin/notifications</code>) is not connected yet. The logs and 11 trigger templates below represent the configured notification architecture.
        </Notice>
      )}
      {error && <Notice tone="error" title="Notifications sync failed">{error}</Notice>}

      <div className="stats-grid">
        <StatCard label="Configured Event Triggers" value={templates.length} subtitle="11 lifecycle triggers" />
        <StatCard
          label="Delivered Emails"
          value={logs.filter((l) => l.deliveryStatus === 'DELIVERED').length}
        />
        <StatCard
          label="Failed Emails (Retryable)"
          value={logs.filter((l) => l.deliveryStatus === 'FAILED').length}
        />
        <StatCard label="Active Channels" value="Email + Web" subtitle="WhatsApp prepared" />
      </div>

      {/* Section Tabs */}
      <div className="order-filters" role="tablist" aria-label="Notification module sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          className={`chip${activeTab === 'history' ? ' chip--active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          Notification History &amp; Retry
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'templates'}
          className={`chip${activeTab === 'templates' ? ' chip--active' : ''}`}
          onClick={() => setActiveTab('templates')}
        >
          Email Templates (11 Triggers)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'settings'}
          className={`chip${activeTab === 'settings' ? ' chip--active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Channel &amp; Dispatch Settings
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : activeTab === 'history' ? (
        <>
          <div className="card card--tinted customer-filters">
            <div style={{ flex: '1 1 220px' }}>
              <label htmlFor="notif-trigger-filter">Filter by Event Trigger</label>
              <select
                id="notif-trigger-filter"
                className="input"
                value={triggerFilter}
                onChange={(e) =>
                  setTriggerFilter(e.target.value as NotificationTriggerEvent | 'ALL')
                }
              >
                <option value="ALL">All 11 Triggers</option>
                {templates.map((t) => (
                  <option key={t.trigger} value={t.trigger}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label htmlFor="notif-status-filter">Email Delivery Status</label>
              <select
                id="notif-status-filter"
                className="input"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as EmailDeliveryStatus | 'ALL')
                }
              >
                <option value="ALL">All Delivery Statuses</option>
                <option value="DELIVERED">Delivered</option>
                <option value="SENT">Sent</option>
                <option value="QUEUED_POST_COMMIT">Queued (Post-Commit)</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
          </div>

          <div className="card">
            <div className="customer-table-scroll" role="region" aria-label="Notification history" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Dispatched At</th>
                    <th scope="col">Order</th>
                    <th scope="col">Customer &amp; Recipient</th>
                    <th scope="col">Trigger Event</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Delivery Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="text-small text-secondary">{log.dispatchedAt}</td>
                      <td><strong>{log.orderNumber}</strong></td>
                      <td>
                        <strong>{log.customerName}</strong>
                        <p className="text-small text-secondary">{log.recipientEmail}</p>
                      </td>
                      <td><code className="text-small">{log.trigger}</code></td>
                      <td className="text-small">
                        {log.subject}
                        {log.errorMessage && (
                          <p className="field-error">{log.errorMessage}</p>
                        )}
                      </td>
                      <td><StatusBadge status={log.deliveryStatus} /></td>
                      <td>
                        {log.deliveryStatus === 'FAILED' ? (
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={busyId === log.id}
                            onClick={() => handleRetryFailedEmail(log)}
                          >
                            {busyId === log.id ? 'Retrying…' : 'Retry Email'}
                          </button>
                        ) : (
                          <span className="text-small text-secondary">Delivered</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredLogs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-secondary">
                        No notification records match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : activeTab === 'templates' ? (
        <div className="card">
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>
            Configured Transactional Email Templates (11 Triggers)
          </h2>
          <p className="text-small text-secondary" style={{ marginBottom: 16 }}>
            Covers the complete payment, fulfillment, cancellation, and refund lifecycle.
          </p>
          <div className="customer-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Trigger Event</th>
                  <th scope="col">Template Name</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Subject Line Template</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((tpl) => (
                  <tr key={tpl.id}>
                    <td><code className="text-small">{tpl.trigger}</code></td>
                    <td><strong>{tpl.name}</strong></td>
                    <td><span className="badge badge--outline">{tpl.channel}</span></td>
                    <td className="text-small">{tpl.subjectTemplate}</td>
                    <td>
                      <span className={`badge ${tpl.enabled ? 'badge--green' : 'badge--outline'}`}>
                        {tpl.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedTemplate(tpl)}
                      >
                        Inspect Template
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <h2 style={{ fontSize: 22, marginBottom: 12 }}>
            Communication Channels &amp; Post-Commit Dispatch Settings
          </h2>
          <div className="summary-row">
            <div>
              <strong>Email Notifications (SMTP / Transactional Provider via FastAPI)</strong>
              <p className="text-small text-secondary">
                Sends payment verification, order confirmation, delivery, and refund emails.
              </p>
            </div>
            <span className="badge badge--green">Enabled</span>
          </div>
          <div className="summary-row">
            <div>
              <strong>In-Website Order Status Updates</strong>
              <p className="text-small text-secondary">
                Updates the customer My Orders timeline immediately after the backend commits the change.
              </p>
            </div>
            <span className="badge badge--green">Enabled</span>
          </div>
          <div className="summary-row">
            <div>
              <strong>Dispatch Only After Database Transaction Commit</strong>
              <p className="text-small text-secondary">
                Prevents premature notifications if a database transaction rolls back.
              </p>
            </div>
            <span className="badge badge--dark">Mandatory</span>
          </div>
          <div className="summary-row">
            <div>
              <strong>Future WhatsApp Integration Hook</strong>
              <p className="text-small text-secondary">
                Prepared in schema and trigger contracts for a future phase (not active in Phase 1).
              </p>
            </div>
            <span className="badge badge--outline">Prepared (Inactive)</span>
          </div>
        </div>
      )}

      {/* Template Drawer */}
      <DetailDrawer
        open={selectedTemplate !== null}
        title={selectedTemplate ? selectedTemplate.name : 'Email Template'}
        subtitle={selectedTemplate ? `Trigger: ${selectedTemplate.trigger}` : undefined}
        onClose={() => setSelectedTemplate(null)}
      >
        {selectedTemplate && (
          <div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="tpl-subject">Email Subject Template</label>
              <input
                id="tpl-subject"
                className="input"
                value={selectedTemplate.subjectTemplate}
                readOnly
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="tpl-body">Email Body Template</label>
              <textarea
                id="tpl-body"
                className="input"
                value={selectedTemplate.bodyTemplate}
                readOnly
              />
            </div>
            <p className="text-small text-secondary">
              Supported placeholders: <code>{'{{customer_name}}'}</code>,{' '}
              <code>{'{{order_number}}'}</code>, <code>{'{{utr_number}}'}</code>,{' '}
              <code>{'{{shipping_address}}'}</code>, <code>{'{{refund_reference}}'}</code>.
            </p>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
