import React, { useState, useEffect } from 'react';
import { useLocale } from '../i18n/index';
import { authedFetch } from '../utils/api';
import './WorkflowEditor.css';

interface Department {
  id: string;
  name: string;
  emoji: string;
}

interface WorkflowStep {
  deptId: string;
  message: string;
  delayMs: number;
}

interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  createdAtMs?: number;
  updatedAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: 'ok' | 'partial' | null;
}

interface StepResult {
  step: number;
  deptId: string;
  success: boolean;
  reply?: string;
  error?: string;
  durationMs: number;
}

interface WorkflowEditorProps {
  onClose: () => void;
}

const WorkflowEditor: React.FC<WorkflowEditorProps> = ({ onClose }) => {
  const { t } = useLocale();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const [results, setResults] = useState<StepResult[] | null>(null);

  // Form state for creating/editing
  const [formName, setFormName] = useState('');
  const [formSteps, setFormSteps] = useState<WorkflowStep[]>([
    { deptId: '', message: '', delayMs: 0 }
  ]);

  // Fetch workflows and departments on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [workflowsRes, deptsRes] = await Promise.all([
          authedFetch('/cmd/api/workflows'),
          authedFetch('/cmd/api/departments')
        ]);

        if (workflowsRes.ok) {
          const data = await workflowsRes.json();
          setWorkflows(data.workflows || []);
        }

        if (deptsRes.ok) {
          const data = await deptsRes.json();
          setDepartments(data.departments || []);
        }
      } catch (err) {
        console.error('Failed to fetch workflows/departments:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Handle creating new workflow
  const handleCreate = () => {
    setEditingWorkflow(null);
    setFormName('');
    setFormSteps([{ deptId: '', message: '', delayMs: 0 }]);
    setResults(null);
  };

  // Handle editing existing workflow
  const handleEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setFormName(workflow.name);
    setFormSteps([...workflow.steps]);
    setResults(null);
  };

  // Handle saving workflow (create or update)
  const handleSave = async () => {
    if (!formName.trim()) return;

    // Filter out empty steps
    const validSteps = formSteps.filter(s => s.deptId && s.message.trim());
    if (validSteps.length === 0) return;

    try {
      const payload = { name: formName, steps: validSteps };
      let res: Response;

      if (editingWorkflow) {
        res = await authedFetch(`/cmd/api/workflows/${editingWorkflow.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await authedFetch('/cmd/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        throw new Error(t('workflow.save.failed'));
      }

      // Refresh workflows list
      const listRes = await authedFetch('/cmd/api/workflows');
      if (listRes.ok) {
        const data = await listRes.json();
        setWorkflows(data.workflows || []);
      }

      // Clear form
      setEditingWorkflow(null);
      setFormName('');
      setFormSteps([{ deptId: '', message: '', delayMs: 0 }]);
    } catch (err) {
      console.error('Failed to save workflow:', err);
      alert(t('workflow.save.failed'));
    }
  };

  // Handle running workflow
  const handleRun = async (workflowId: string) => {
    try {
      setRunningWorkflowId(workflowId);
      setResults(null);

      const res = await authedFetch(`/cmd/api/workflows/${workflowId}/run`, {
        method: 'POST'
      });

      if (!res.ok) {
        throw new Error(t('workflow.run.failed'));
      }

      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error('Failed to run workflow:', err);
      alert(t('workflow.run.failed'));
    } finally {
      setRunningWorkflowId(null);
    }
  };

  // Handle deleting workflow
  const handleDelete = async (workflowId: string) => {
    if (!window.confirm(t('workflow.delete.confirm'))) return;

    try {
      const res = await authedFetch(`/cmd/api/workflows/${workflowId}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        throw new Error(t('workflow.delete.failed'));
      }

      // Refresh list
      setWorkflows(workflows.filter(w => w.id !== workflowId));
    } catch (err) {
      console.error('Failed to delete workflow:', err);
      alert(t('workflow.delete.failed'));
    }
  };

  // Handle step change
  const handleStepChange = (index: number, field: keyof WorkflowStep, value: string | number) => {
    const newSteps = [...formSteps];
    if (field === 'delayMs') {
      newSteps[index][field] = typeof value === 'number' ? value * 1000 : parseInt(value as string) * 1000;
    } else {
      newSteps[index][field] = value as any;
    }
    setFormSteps(newSteps);
  };

  // Add new step
  const handleAddStep = () => {
    setFormSteps([...formSteps, { deptId: '', message: '', delayMs: 0 }]);
  };

  // Remove step
  const handleRemoveStep = (index: number) => {
    if (formSteps.length > 1) {
      setFormSteps(formSteps.filter((_, i) => i !== index));
    }
  };

  const getDepartmentName = (deptId: string) => {
    const dept = departments.find(d => d.id === deptId);
    return dept ? `${dept.emoji} ${dept.name}` : deptId;
  };

  return (
    <div className="workflow-overlay" onClick={onClose}>
      <div className="workflow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="workflow-header">
          <h2>{t('workflow.title')}</h2>
          <button className="workflow-close" onClick={onClose}>×</button>
        </div>

        <div className="workflow-body">
          {/* Left side: Workflows list */}
          <div className="workflow-list">
            <button className="workflow-create-btn" onClick={handleCreate}>
              {t('workflow.create')}
            </button>

            {loading ? (
              <div className="workflow-loading">{t('workflow.loading')}</div>
            ) : workflows.length === 0 ? (
              <div className="workflow-empty">{t('workflow.empty')}</div>
            ) : (
              <div className="workflow-items">
                {workflows.map((workflow) => (
                  <div key={workflow.id} className="workflow-item">
                    <div className="workflow-item-header">
                      <span className="workflow-item-name">{workflow.name}</span>
                      <span className="workflow-item-count">
                        {workflow.steps.length} {t('workflow.step', { num: '' }).replace(/\s*\d*$/, 's')}
                      </span>
                    </div>
                    {workflow.lastRunStatus && (
                      <div className="workflow-lastrun">
                        {t('workflow.lastrun', {
                          status: t(`workflow.result.${workflow.lastRunStatus === 'ok' ? 'success' : 'failed'}`)
                        })}
                      </div>
                    )}
                    <div className="workflow-item-actions">
                      <button
                        className="workflow-btn-run"
                        onClick={() => handleRun(workflow.id)}
                        disabled={runningWorkflowId === workflow.id}
                      >
                        {runningWorkflowId === workflow.id ? t('workflow.running') : t('workflow.run')}
                      </button>
                      <button
                        className="workflow-btn-edit"
                        onClick={() => handleEdit(workflow)}
                      >
                        {t('cron.edit')}
                      </button>
                      <button
                        className="workflow-btn-delete"
                        onClick={() => handleDelete(workflow.id)}
                      >
                        {t('workflow.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right side: Form or Results */}
          <div className="workflow-editor">
            {results ? (
              /* Results view */
              <div className="workflow-results">
                <h3>{t('workflow.result.title')}</h3>
                <div className="workflow-results-summary">
                  {t('workflow.result.steps', {
                    success: results.filter(r => r.success).length,
                    total: results.length
                  })}
                </div>
                <div className="workflow-results-list">
                  {results.map((result, idx) => (
                    <div
                      key={idx}
                      className={`workflow-result-item ${result.success ? 'success' : 'failed'}`}
                    >
                      <div className="workflow-result-header">
                        <span className="workflow-result-step">
                          {t('workflow.step', { num: result.step })}
                        </span>
                        <span className="workflow-result-dept">
                          {getDepartmentName(result.deptId)}
                        </span>
                        <span className="workflow-result-status">
                          {result.success ? t('workflow.result.success') : t('workflow.result.failed')}
                        </span>
                        <span className="workflow-result-duration">
                          {result.durationMs}ms
                        </span>
                      </div>
                      {result.reply && (
                        <div className="workflow-result-reply">{result.reply}</div>
                      )}
                      {result.error && (
                        <div className="workflow-result-error">{result.error}</div>
                      )}
                    </div>
                  ))}
                </div>
                <button className="workflow-btn-close-results" onClick={() => setResults(null)}>
                  {t('common.close')}
                </button>
              </div>
            ) : (
              /* Form view */
              <div className="workflow-form">
                <div className="workflow-form-field">
                  <label>{t('workflow.name')}</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={t('workflow.name.placeholder')}
                    className="workflow-input"
                  />
                </div>

                <div className="workflow-steps">
                  {formSteps.map((step, idx) => (
                    <div key={idx} className="workflow-step">
                      <div className="workflow-step-header">
                        <span className="workflow-step-label">
                          {t('workflow.step', { num: idx + 1 })}
                        </span>
                        {formSteps.length > 1 && (
                          <button
                            className="workflow-btn-remove"
                            onClick={() => handleRemoveStep(idx)}
                          >
                            {t('workflow.step.remove')}
                          </button>
                        )}
                      </div>

                      <div className="workflow-step-fields">
                        <div className="workflow-step-row">
                          <div className="workflow-step-field">
                            <label>{t('workflow.step.dept')}</label>
                            <select
                              value={step.deptId}
                              onChange={(e) => handleStepChange(idx, 'deptId', e.target.value)}
                              className="workflow-select"
                            >
                              <option value="">-- {t('workflow.step.dept')} --</option>
                              {departments.map((dept) => (
                                <option key={dept.id} value={dept.id}>
                                  {dept.emoji} {dept.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="workflow-step-field workflow-step-delay">
                            <label>{t('workflow.step.delay')}</label>
                            <input
                              type="number"
                              min="0"
                              value={step.delayMs / 1000}
                              onChange={(e) => handleStepChange(idx, 'delayMs', e.target.value)}
                              className="workflow-input"
                            />
                          </div>
                        </div>

                        <div className="workflow-step-field">
                          <label>{t('workflow.step.message')}</label>
                          <textarea
                            value={step.message}
                            onChange={(e) => handleStepChange(idx, 'message', e.target.value)}
                            placeholder={t('workflow.step.message.placeholder')}
                            className="workflow-textarea"
                            rows={3}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button className="workflow-btn-add-step" onClick={handleAddStep}>
                  {t('workflow.step.add')}
                </button>

                <div className="workflow-form-actions">
                  <button className="workflow-btn-save" onClick={handleSave}>
                    {t('workflow.save')}
                  </button>
                  <button
                    className="workflow-btn-cancel"
                    onClick={() => {
                      setEditingWorkflow(null);
                      setFormName('');
                      setFormSteps([{ deptId: '', message: '', delayMs: 0 }]);
                    }}
                  >
                    {t('workflow.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowEditor;
