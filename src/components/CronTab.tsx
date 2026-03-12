import React, { useState, useEffect, useCallback } from 'react';
import type { Department } from '../hooks/useAgentState';
import { DeptIcon } from './Icons';
import { useToast } from './Toast';
import { useLocale } from '../i18n/index';
import { authedFetch } from '../utils/api';
import { useVisibilityInterval } from '../hooks/useVisibilityInterval';
import './CronTab.css';

interface CronJob {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  deptId?: string;
  subAgentId?: string;
  schedule: {
    kind: 'every' | 'cron';
    everyMs?: number;
    expr?: string;
    anchorMs?: number;
  };
  sessionTarget: string;
  wakeMode: string;
  payload: {
    kind: string;
    message: string;
    model?: string;
    timeoutSeconds?: number;
  };
  delivery: { mode: string };
  state?: {
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
    lastError?: string;
    executionHistory?: { timestamp: number; durationMs: number; success: boolean; responseLength: number }[];
  };
}

interface SubAgent {
  id: string;
  name: string;
  task: string;
  status: string;
}

interface CreateJobForm {
  name: string;
  deptId: string;
  subAgentId: string;
  scheduleKind: 'every' | 'cron';
  intervalMinutes: number;
  cronExpr: string;
  message: string;
  timeoutSeconds: number;
}

interface CronTabProps {
  departments: Department[];
  selectedDeptId: string | null;
}

const CronTab: React.FC<CronTabProps> = ({ departments, selectedDeptId }) => {
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  const [filter, setFilter] = useState<string>('all'); // 'all' or deptId

  const [form, setForm] = useState<CreateJobForm>({
    name: '',
    deptId: selectedDeptId || '',
    subAgentId: '',
    scheduleKind: 'every',
    intervalMinutes: 10,
    cronExpr: '*/15 * * * *',
    message: '',
    timeoutSeconds: 120,
  });

  const fetchJobs = useCallback(async () => {
    try {
      const response = await authedFetch('/api/cron/jobs');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setJobs(data.jobs || []);
      // ok
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('cron.load.failed'));
    } finally {
      setLoading(false);
    }
  }, [t, showToast]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useVisibilityInterval(fetchJobs, 30000, [fetchJobs]);

  useEffect(() => {
    if (form.deptId) {
      authedFetch(`/api/departments/${form.deptId}/subagents`)
        .then(r => r.json())
        .then(data => setSubAgents(data.agents || []))
        .catch(() => setSubAgents([]));
    } else {
      setSubAgents([]);
      setForm(prev => ({ ...prev, subAgentId: '' }));
    }
  }, [form.deptId]);

  const handleCreateJob = async () => {
    if (!form.name.trim() || !form.message.trim()) {
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        schedule: form.scheduleKind === 'every'
          ? { kind: 'every', everyMs: form.intervalMinutes * 60 * 1000 }
          : { kind: 'cron', expr: form.cronExpr },
        message: form.message,
        timeoutSeconds: form.timeoutSeconds,
      };
      if (form.deptId) {
        payload.deptId = form.deptId;
      }
      if (form.subAgentId) {
        payload.subAgentId = form.subAgentId;
      }

      const response = await authedFetch('/api/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await fetchJobs();
      setShowCreateForm(false);
      setForm({
        name: '',
        deptId: selectedDeptId || '',
        subAgentId: '',
        scheduleKind: 'every',
        intervalMinutes: 10,
        cronExpr: '*/15 * * * *',
        message: '',
        timeoutSeconds: 120,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('cron.create.failed'));
    }
  };

  const handleToggleEnabled = async (job: CronJob) => {
    try {
      const response = await authedFetch(`/api/cron/jobs/${job.id}/toggle`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await fetchJobs();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('cron.toggle.failed'));
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      const response = await authedFetch(`/api/cron/jobs/${jobId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await fetchJobs();
      setDeleteConfirmId(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('cron.delete.failed'));
    }
  };

  const handleUpdateMessage = async (job: CronJob) => {
    if (!editMessage.trim()) {
      return;
    }

    try {
      const payload = {
        ...job,
        payload: {
          ...job.payload,
          message: editMessage,
        },
      };

      const response = await authedFetch(`/api/cron/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await fetchJobs();
      setEditingJobId(null);
      setEditMessage('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('cron.update.failed'));
    }
  };

  const handleRunNow = async (job: CronJob) => {
    setRunningJobId(job.id);
    try {
      const response = await authedFetch(`/api/cron/jobs/${job.id}/run`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      await fetchJobs();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('cron.run.failed'));
    } finally {
      setRunningJobId(null);
    }
  };

  const formatSchedule = (schedule: CronJob['schedule']): string => {
    if (schedule.kind === 'every' && schedule.everyMs) {
      const minutes = schedule.everyMs / (60 * 1000);
      const hours = minutes / 60;
      const days = hours / 24;

      if (days >= 1 && days % 1 === 0) {
        return t('cron.schedule.every.day', { days });
      } else if (hours >= 1 && hours % 1 === 0) {
        return t('cron.schedule.every.hour', { hours });
      } else {
        return t('cron.schedule.every.minute', { minutes });
      }
    } else if (schedule.kind === 'cron' && schedule.expr) {
      return schedule.expr;
    }
    return t('cron.schedule.unknown');
  };

  const formatTime = (ms?: number): string => {
    if (!ms) return '-';
    const date = new Date(ms);
    const now = new Date();
    const diff = now.getTime() - ms;

    if (diff < 60000) {
      return t('cron.time.now');
    } else if (diff < 3600000) {
      return t('cron.time.minutes', { minutes: Math.floor(diff / 60000) });
    } else if (diff < 86400000) {
      return t('cron.time.hours', { hours: Math.floor(diff / 3600000) });
    } else {
      return date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
    }
  };

  const formatDuration = (ms?: number): string => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStatusDot = (job: CronJob): React.ReactNode => {
    if (!job.enabled) {
      return <span className="status-dot disabled" title={t('cron.status.disabled')}></span>;
    }
    if (job.state?.lastStatus === 'error') {
      return <span className="status-dot error" title={t('cron.status.error')}></span>;
    }
    if (job.state?.lastStatus === 'ok') {
      return <span className="status-dot ok" title={t('cron.status.ok')}></span>;
    }
    return <span className="status-dot pending" title={t('cron.status.pending')}></span>;
  };

  if (loading) {
    return (
      <div className="cron-tab">
        <div className="loading">{t('cron.loading')}</div>
      </div>
    );
  }

  return (
    <div className="cron-tab">
      <div className="cron-header">
        <h2>{t('cron.title')}</h2>
        <button
          className="btn-create-toggle"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? t('cron.cancel') : t('cron.create')}
        </button>
      </div>

      {showCreateForm && (
        <div className="create-form">
          <div className="form-group">
            <label>{t('cron.form.name')}</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('cron.form.name.placeholder')}
            />
          </div>

          <div className="form-group">
            <label>{t('cron.form.assign')}</label>
            <select
              value={form.deptId}
              onChange={(e) => setForm({ ...form, deptId: e.target.value })}
              className="dept-select"
            >
              <option value="">{t('cron.form.global')}</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {form.deptId && subAgents.length > 0 && (
            <div className="form-group">
              <label>{t('cron.form.subagent')}</label>
              <select
                value={form.subAgentId}
                onChange={(e) => setForm({ ...form, subAgentId: e.target.value })}
                className="dept-select"
              >
                <option value="">{t('cron.form.subagent.main')}</option>
                {subAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.name} - {a.task.substring(0, 30)}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label>{t('cron.form.schedule')}</label>
            <div className="schedule-type-selector">
              <button
                className={form.scheduleKind === 'every' ? 'active' : ''}
                onClick={() => setForm({ ...form, scheduleKind: 'every' })}
              >
                {t('cron.form.schedule.interval')}
              </button>
              <button
                className={form.scheduleKind === 'cron' ? 'active' : ''}
                onClick={() => setForm({ ...form, scheduleKind: 'cron' })}
              >
                {t('cron.form.schedule.cron')}
              </button>
            </div>
          </div>

          {form.scheduleKind === 'every' ? (
            <div className="form-group">
              <label>{t('cron.form.interval')}</label>
              <input
                type="number"
                value={form.intervalMinutes}
                onChange={(e) => setForm({ ...form, intervalMinutes: parseInt(e.target.value) || 1 })}
                min="1"
              />
            </div>
          ) : (
            <div className="form-group">
              <label>{t('cron.form.cron')}</label>
              <input
                type="text"
                className="cron-input"
                value={form.cronExpr}
                onChange={(e) => setForm({ ...form, cronExpr: e.target.value })}
                placeholder="*/15 * * * *"
              />
            </div>
          )}

          <div className="form-group">
            <label>{t('cron.form.message')}</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder={t('cron.form.message.placeholder')}
              rows={4}
            />
          </div>

          <div className="form-group">
            <label>{t('cron.form.timeout')}</label>
            <input
              type="number"
              value={form.timeoutSeconds}
              onChange={(e) => setForm({ ...form, timeoutSeconds: parseInt(e.target.value) || 120 })}
              min="1"
            />
          </div>

          <button
            className="btn-create"
            onClick={handleCreateJob}
            disabled={!form.name.trim() || !form.message.trim()}
          >
            {t('cron.form.submit')}
          </button>
        </div>
      )}

      {/* Filter by department */}
      <div className="cron-filter-bar">
        <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>{t('cron.filter.all')}</button>
        <button className={`filter-chip ${filter === 'global' ? 'active' : ''}`} onClick={() => setFilter('global')}>{t('cron.filter.global')}</button>
        {departments.map(d => (
          <button key={d.id} className={`filter-chip ${filter === d.id ? 'active' : ''}`} onClick={() => setFilter(d.id)} title={d.name}><DeptIcon deptId={d.id} size={14} /> <span className="filter-chip-text">{d.name}</span></button>
        ))}
      </div>

      <div className="jobs-list">
        {jobs.filter(j => filter === 'all' ? true : filter === 'global' ? !j.deptId : j.deptId === filter).length === 0 ? (
          <div className="empty-state">{t('cron.empty')}</div>
        ) : (
          jobs.filter(j => filter === 'all' ? true : filter === 'global' ? !j.deptId : j.deptId === filter).map((job) => (
            <div key={job.id} className="job-item">
              <div className="job-header" onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}>
                <div className="job-main-info">
                  {getStatusDot(job)}
                  <div className="job-name-schedule">
                    <div className="job-name">
                      {job.deptId && (
                        <span className="job-dept-badge"><DeptIcon deptId={job.deptId!} size={10} /> {departments.find(d => d.id === job.deptId)?.name || job.deptId}</span>
                      )}
                      {job.subAgentId && (
                        <span className="job-sub-badge">{job.subAgentId}</span>
                      )}
                      {job.name}
                    </div>
                    <div className={`job-schedule ${job.schedule.kind === 'cron' ? 'cron-expr' : ''}`}>
                      {formatSchedule(job.schedule)}
                    </div>
                  </div>
                </div>
                <div className="job-controls" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn-run-now"
                    onClick={() => handleRunNow(job)}
                    disabled={runningJobId === job.id}
                    title={t('cron.action.run')}
                  >
                    {runningJobId === job.id ? '⟳' : '▶'}
                  </button>
                  <button
                    className={`toggle-switch ${job.enabled ? 'enabled' : 'disabled'}`}
                    onClick={() => handleToggleEnabled(job)}
                    title={job.enabled ? t('cron.action.disable') : t('cron.action.enable')}
                  >
                    <span className="toggle-slider"></span>
                  </button>
                  {deleteConfirmId === job.id ? (
                    <div className="delete-confirm">
                      <button
                        className="btn-confirm-delete"
                        onClick={() => handleDeleteJob(job.id)}
                      >
                        {t('cron.action.delete.confirm')}
                      </button>
                      <button
                        className="btn-cancel-delete"
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        {t('cron.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn-delete"
                      onClick={() => setDeleteConfirmId(job.id)}
                      title={t('cron.action.delete')}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {job.state && (
                <div className="job-last-run">
                  <span className="last-run-label">{t('cron.lastrun.label')}</span>
                  <span className="last-run-time">{formatTime(job.state.lastRunAtMs)}</span>
                  {job.state.lastStatus && (
                    <span className={`last-run-status ${job.state.lastStatus}`}>
                      {job.state.lastStatus === 'ok' ? t('cron.lastrun.success') : t('cron.lastrun.failed')}
                    </span>
                  )}
                  {job.state.lastDurationMs !== undefined && (
                    <span className="last-run-duration">({formatDuration(job.state.lastDurationMs)})</span>
                  )}
                </div>
              )}

              {expandedJobId === job.id && (
                <div className="job-details">
                  <div className="detail-section">
                    <div className="detail-label">{t('cron.detail.assign')}</div>
                    <div className="state-grid">
                      <div className="state-item">
                        <span className="state-key">{t('cron.detail.dept')}</span>
                        <span className="state-value">{job.deptId ? (departments.find(d => d.id === job.deptId)?.name || job.deptId) : t('cron.detail.dept.global')}</span>
                      </div>
                      {job.subAgentId && (
                        <div className="state-item">
                          <span className="state-key">{t('cron.detail.subagent')}</span>
                          <span className="state-value">{job.subAgentId}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="detail-section">
                    <div className="detail-label">{t('cron.detail.message')}</div>
                    {editingJobId === job.id ? (
                      <div className="edit-message">
                        <textarea
                          value={editMessage}
                          onChange={(e) => setEditMessage(e.target.value)}
                          rows={4}
                        />
                        <div className="edit-actions">
                          <button
                            className="btn-save"
                            onClick={() => handleUpdateMessage(job)}
                            disabled={!editMessage.trim()}
                          >
                            {t('cron.detail.save')}
                          </button>
                          <button
                            className="btn-cancel"
                            onClick={() => {
                              setEditingJobId(null);
                              setEditMessage('');
                            }}
                          >
                            {t('cron.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="message-display">
                        <div className="message-text">{job.payload.message}</div>
                        <button
                          className="btn-edit"
                          onClick={() => {
                            setEditingJobId(job.id);
                            setEditMessage(job.payload.message);
                          }}
                        >
                          {t('cron.edit')}
                        </button>
                      </div>
                    )}
                  </div>

                  {job.state && (
                    <div className="detail-section">
                      <div className="detail-label">{t('cron.detail.state')}</div>
                      <div className="state-grid">
                        <div className="state-item">
                          <span className="state-key">{t('cron.detail.lastrun')}</span>
                          <span className="state-value">{formatTime(job.state.lastRunAtMs)}</span>
                        </div>
                        <div className="state-item">
                          <span className="state-key">{t('cron.detail.duration')}</span>
                          <span className="state-value">{formatDuration(job.state.lastDurationMs)}</span>
                        </div>
                        <div className="state-item">
                          <span className="state-key">{t('cron.detail.consecutive_errors')}</span>
                          <span className="state-value">{job.state.consecutiveErrors || 0}</span>
                        </div>
                        {job.state.lastError && (
                          <div className="state-item full-width">
                            <span className="state-key">{t('cron.detail.error')}</span>
                            <span className="state-value error-text">{job.state.lastError}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {job.state?.executionHistory && job.state.executionHistory.length > 0 && (
                    <div className="detail-section">
                      <div className="detail-label">{t('cron.history.title')}</div>
                      <div className="cron-history-chart">
                        {(() => {
                          const maxDuration = Math.max(...job.state.executionHistory.map(h => h.durationMs));
                          return job.state.executionHistory.map((exec, idx) => {
                            const heightPercent = Math.max(5, (exec.durationMs / maxDuration) * 100);
                            return (
                              <div
                                key={idx}
                                className={`cron-history-bar ${exec.success ? '' : 'error'}`}
                                style={{ height: `${heightPercent}%` }}
                                title={`${formatDuration(exec.durationMs)}`}
                              />
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}

                  <div className="detail-section">
                    <div className="detail-label">{t('cron.detail.other')}</div>
                    <div className="state-grid">
                      <div className="state-item">
                        <span className="state-key">{t('cron.detail.jobid')}</span>
                        <span className="state-value mono">{job.id}</span>
                      </div>
                      <div className="state-item">
                        <span className="state-key">{t('cron.detail.timeout')}</span>
                        <span className="state-value">{t('cron.detail.timeout.value', { seconds: job.payload.timeoutSeconds || 120 })}</span>
                      </div>
                      <div className="state-item">
                        <span className="state-key">{t('cron.detail.created')}</span>
                        <span className="state-value">{new Date(job.createdAtMs).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</span>
                      </div>
                      <div className="state-item">
                        <span className="state-key">{t('cron.detail.updated')}</span>
                        <span className="state-value">{new Date(job.updatedAtMs).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CronTab;
