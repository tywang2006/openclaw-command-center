import React, { useState, useEffect, useCallback } from 'react';
import type { Department } from '../hooks/useAgentState';
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
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      const response = await fetch('/cmd/api/cron/jobs');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setJobs(data.jobs || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 30000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  useEffect(() => {
    if (form.deptId) {
      fetch(`/cmd/api/departments/${form.deptId}/subagents`)
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

      const response = await fetch('/cmd/api/cron/jobs', {
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
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  const handleToggleEnabled = async (job: CronJob) => {
    try {
      const response = await fetch(`/cmd/api/cron/jobs/${job.id}/toggle`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换失败');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      const response = await fetch(`/cmd/api/cron/jobs/${jobId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await fetchJobs();
      setDeleteConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
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

      const response = await fetch(`/cmd/api/cron/jobs/${job.id}`, {
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
      setError(err instanceof Error ? err.message : '更新失败');
    }
  };

  const handleRunNow = async (job: CronJob) => {
    setRunningJobId(job.id);
    try {
      const response = await fetch(`/cmd/api/cron/jobs/${job.id}/run`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行失败');
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
        return `每 ${days} 天`;
      } else if (hours >= 1 && hours % 1 === 0) {
        return `每 ${hours} 小时`;
      } else {
        return `每 ${minutes} 分钟`;
      }
    } else if (schedule.kind === 'cron' && schedule.expr) {
      return schedule.expr;
    }
    return '未知';
  };

  const formatTime = (ms?: number): string => {
    if (!ms) return '-';
    const date = new Date(ms);
    const now = new Date();
    const diff = now.getTime() - ms;

    if (diff < 60000) {
      return '刚刚';
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)} 分钟前`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)} 小时前`;
    } else {
      return date.toLocaleString('zh-CN');
    }
  };

  const formatDuration = (ms?: number): string => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStatusDot = (job: CronJob): React.ReactNode => {
    if (!job.enabled) {
      return <span className="status-dot disabled" title="已禁用"></span>;
    }
    if (job.state?.lastStatus === 'error') {
      return <span className="status-dot error" title="错误"></span>;
    }
    if (job.state?.lastStatus === 'ok') {
      return <span className="status-dot ok" title="正常"></span>;
    }
    return <span className="status-dot pending" title="待运行"></span>;
  };

  if (loading) {
    return (
      <div className="cron-tab">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="cron-tab">
      <div className="cron-header">
        <h2>定时任务</h2>
        <button
          className="btn-create-toggle"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? '取消' : '+ 创建'}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {showCreateForm && (
        <div className="create-form">
          <div className="form-group">
            <label>定时器名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例: 每日备份"
            />
          </div>

          <div className="form-group">
            <label>分配给</label>
            <select
              value={form.deptId}
              onChange={(e) => setForm({ ...form, deptId: e.target.value })}
              className="dept-select"
            >
              <option value="">全局 (无部门)</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>
              ))}
            </select>
          </div>

          {form.deptId && subAgents.length > 0 && (
            <div className="form-group">
              <label>子代理 (可选)</label>
              <select
                value={form.subAgentId}
                onChange={(e) => setForm({ ...form, subAgentId: e.target.value })}
                className="dept-select"
              >
                <option value="">部门主代理</option>
                {subAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.name} - {a.task.substring(0, 30)}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label>调度方式</label>
            <div className="schedule-type-selector">
              <button
                className={form.scheduleKind === 'every' ? 'active' : ''}
                onClick={() => setForm({ ...form, scheduleKind: 'every' })}
              >
                间隔
              </button>
              <button
                className={form.scheduleKind === 'cron' ? 'active' : ''}
                onClick={() => setForm({ ...form, scheduleKind: 'cron' })}
              >
                Cron表达式
              </button>
            </div>
          </div>

          {form.scheduleKind === 'every' ? (
            <div className="form-group">
              <label>间隔(分钟)</label>
              <input
                type="number"
                value={form.intervalMinutes}
                onChange={(e) => setForm({ ...form, intervalMinutes: parseInt(e.target.value) || 1 })}
                min="1"
              />
            </div>
          ) : (
            <div className="form-group">
              <label>Cron表达式</label>
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
            <label>消息内容</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="输入要执行的任务描述..."
              rows={4}
            />
          </div>

          <div className="form-group">
            <label>超时(秒)</label>
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
            创建定时任务
          </button>
        </div>
      )}

      {/* Filter by department */}
      <div className="cron-filter-bar">
        <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>全部</button>
        <button className={`filter-chip ${filter === 'global' ? 'active' : ''}`} onClick={() => setFilter('global')}>全局</button>
        {departments.map(d => (
          <button key={d.id} className={`filter-chip ${filter === d.id ? 'active' : ''}`} onClick={() => setFilter(d.id)}>{d.emoji}</button>
        ))}
      </div>

      <div className="jobs-list">
        {jobs.filter(j => filter === 'all' ? true : filter === 'global' ? !j.deptId : j.deptId === filter).length === 0 ? (
          <div className="empty-state">暂无定时任务</div>
        ) : (
          jobs.filter(j => filter === 'all' ? true : filter === 'global' ? !j.deptId : j.deptId === filter).map((job) => (
            <div key={job.id} className="job-item">
              <div className="job-header" onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}>
                <div className="job-main-info">
                  {getStatusDot(job)}
                  <div className="job-name-schedule">
                    <div className="job-name">
                      {job.deptId && (
                        <span className="job-dept-badge">{departments.find(d => d.id === job.deptId)?.emoji || ''} {departments.find(d => d.id === job.deptId)?.name || job.deptId}</span>
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
                    title="立即执行"
                  >
                    {runningJobId === job.id ? '⟳' : '▶'}
                  </button>
                  <button
                    className={`toggle-switch ${job.enabled ? 'enabled' : 'disabled'}`}
                    onClick={() => handleToggleEnabled(job)}
                    title={job.enabled ? '禁用' : '启用'}
                  >
                    <span className="toggle-slider"></span>
                  </button>
                  {deleteConfirmId === job.id ? (
                    <div className="delete-confirm">
                      <button
                        className="btn-confirm-delete"
                        onClick={() => handleDeleteJob(job.id)}
                      >
                        确认
                      </button>
                      <button
                        className="btn-cancel-delete"
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn-delete"
                      onClick={() => setDeleteConfirmId(job.id)}
                      title="删除"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {job.state && (
                <div className="job-last-run">
                  <span className="last-run-label">上次运行:</span>
                  <span className="last-run-time">{formatTime(job.state.lastRunAtMs)}</span>
                  {job.state.lastStatus && (
                    <span className={`last-run-status ${job.state.lastStatus}`}>
                      {job.state.lastStatus === 'ok' ? '成功' : '失败'}
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
                    <div className="detail-label">代理分配:</div>
                    <div className="state-grid">
                      <div className="state-item">
                        <span className="state-key">部门:</span>
                        <span className="state-value">{job.deptId ? (departments.find(d => d.id === job.deptId)?.name || job.deptId) : '全局'}</span>
                      </div>
                      {job.subAgentId && (
                        <div className="state-item">
                          <span className="state-key">子代理:</span>
                          <span className="state-value">{job.subAgentId}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="detail-section">
                    <div className="detail-label">消息内容:</div>
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
                            保存
                          </button>
                          <button
                            className="btn-cancel"
                            onClick={() => {
                              setEditingJobId(null);
                              setEditMessage('');
                            }}
                          >
                            取消
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
                          编辑
                        </button>
                      </div>
                    )}
                  </div>

                  {job.state && (
                    <div className="detail-section">
                      <div className="detail-label">状态信息:</div>
                      <div className="state-grid">
                        <div className="state-item">
                          <span className="state-key">上次运行:</span>
                          <span className="state-value">{formatTime(job.state.lastRunAtMs)}</span>
                        </div>
                        <div className="state-item">
                          <span className="state-key">运行时长:</span>
                          <span className="state-value">{formatDuration(job.state.lastDurationMs)}</span>
                        </div>
                        <div className="state-item">
                          <span className="state-key">连续错误:</span>
                          <span className="state-value">{job.state.consecutiveErrors || 0}</span>
                        </div>
                        {job.state.lastError && (
                          <div className="state-item full-width">
                            <span className="state-key">错误信息:</span>
                            <span className="state-value error-text">{job.state.lastError}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="detail-section">
                    <div className="detail-label">其他信息:</div>
                    <div className="state-grid">
                      <div className="state-item">
                        <span className="state-key">任务ID:</span>
                        <span className="state-value mono">{job.id}</span>
                      </div>
                      <div className="state-item">
                        <span className="state-key">超时设置:</span>
                        <span className="state-value">{job.payload.timeoutSeconds || 120}秒</span>
                      </div>
                      <div className="state-item">
                        <span className="state-key">创建时间:</span>
                        <span className="state-value">{new Date(job.createdAtMs).toLocaleString('zh-CN')}</span>
                      </div>
                      <div className="state-item">
                        <span className="state-key">更新时间:</span>
                        <span className="state-value">{new Date(job.updatedAtMs).toLocaleString('zh-CN')}</span>
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
