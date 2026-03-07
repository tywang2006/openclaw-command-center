import React, { useState, useEffect } from 'react';
import { useLocale } from '../i18n/index';
import { authedFetch } from '../utils/api';
import WorkflowEditor from './WorkflowEditor';
import './SkillsTab.css';

interface Skill {
  slug: string;
  name: string;
  summary: string;
  description: string;
  tags: string[];
  version: string;
  hasAssets: boolean;
}

interface SkillDetail extends Skill {
  markdown?: string;
  ownerId?: string;
  publishedAt?: number;
}

const SkillsTab: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const { t } = useLocale();

  // Fetch all skills on mount
  useEffect(() => {
    const fetchSkills = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await authedFetch('/cmd/api/skills');
        if (!response.ok) {
          throw new Error(`${t('skills.error.fetch')}: ${response.status}`);
        }
        const data = await response.json();
        setSkills(data.skills || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('skills.error.unknown'));
        console.error('Failed to fetch skills:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSkills();
  }, [t]);

  // Fetch skill detail when a skill is selected
  const handleSkillClick = async (slug: string) => {
    try {
      setDetailLoading(true);
      const response = await authedFetch(`/cmd/api/skills/${slug}`);
      if (!response.ok) {
        throw new Error(`${t('skills.error.detail')}: ${response.status}`);
      }
      const data = await response.json();
      setSelectedSkill(data.skill || data);
    } catch (err) {
      console.error('Failed to fetch skill detail:', err);
      setError(err instanceof Error ? err.message : t('skills.error.detail.failed'));
    } finally {
      setDetailLoading(false);
    }
  };

  // Close detail view
  const handleCloseDetail = () => {
    setSelectedSkill(null);
  };

  // Filter skills based on search query
  const filteredSkills = skills.filter(skill => {
    const query = searchQuery.toLowerCase();
    return (
      skill.name.toLowerCase().includes(query) ||
      skill.summary.toLowerCase().includes(query) ||
      skill.tags.some(tag => tag.toLowerCase().includes(query))
    );
  });

  // Get tag color based on tag name
  const getTagColor = (tag: string): string => {
    const tagLower = tag.toLowerCase();

    // Category-based coloring
    if (tagLower.includes('web') || tagLower.includes('frontend')) return 'tag-web';
    if (tagLower.includes('backend') || tagLower.includes('server')) return 'tag-backend';
    if (tagLower.includes('data') || tagLower.includes('database')) return 'tag-data';
    if (tagLower.includes('ai') || tagLower.includes('ml')) return 'tag-ai';
    if (tagLower.includes('devops') || tagLower.includes('cloud')) return 'tag-devops';
    if (tagLower.includes('mobile') || tagLower.includes('ios') || tagLower.includes('android')) return 'tag-mobile';
    if (tagLower.includes('security')) return 'tag-security';
    if (tagLower.includes('tool') || tagLower.includes('utility')) return 'tag-tool';

    // Default color
    return 'tag-default';
  };

  if (loading) {
    return (
      <div className="skills-tab">
        <div className="skills-loading">
          <div className="loading-spinner"></div>
          <p>{t('skills.loading')}</p>
        </div>
      </div>
    );
  }

  if (error && skills.length === 0) {
    return (
      <div className="skills-tab">
        <div className="skills-error">
          <p>{t('skills.error.load')}: {error}</p>
          <button onClick={() => window.location.reload()}>{t('skills.error.reload')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="skills-tab">
      {/* Search Bar */}
      <div className="skills-header">
        <div className="skills-header-top">
          <h2>{t('skills.title')}</h2>
          <button className="workflow-btn" onClick={() => setShowWorkflows(true)}>
            {t('workflow.title')}
          </button>
        </div>
        <div className="skills-search">
          <input
            type="text"
            placeholder={t('skills.search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button
              className="search-clear"
              onClick={() => setSearchQuery('')}
              aria-label={t('skills.search.clear')}
            >
              ×
            </button>
          )}
        </div>
        <div className="skills-count">
          {t('skills.count', { count: filteredSkills.length })}
        </div>
      </div>

      {/* Skills Grid */}
      <div className="skills-grid">
        {filteredSkills.length === 0 ? (
          <div className="skills-empty">
            <p>{t('skills.empty')}</p>
          </div>
        ) : (
          filteredSkills.map((skill) => (
            <div
              key={skill.slug}
              className="skill-card"
              onClick={() => handleSkillClick(skill.slug)}
            >
              <div className="skill-card-header">
                <h3 className="skill-name">{skill.name}</h3>
                <span className="skill-version">{t('skills.version', { version: skill.version })}</span>
              </div>
              <p className="skill-summary">{skill.summary}</p>
              <div className="skill-tags">
                {skill.tags.map((tag, index) => (
                  <span
                    key={index}
                    className={`skill-tag ${getTagColor(tag)}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              {skill.hasAssets && (
                <div className="skill-badge">
                  <span className="assets-badge">{t('skills.badge.assets')}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Skill Detail Modal */}
      {selectedSkill && (
        <div className="skill-detail-overlay" onClick={handleCloseDetail}>
          <div className="skill-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="skill-detail-header">
              <div className="skill-detail-title">
                <h2>{selectedSkill.name}</h2>
                <span className="skill-version">{t('skills.version', { version: selectedSkill.version })}</span>
              </div>
              <button
                className="close-button"
                onClick={handleCloseDetail}
                aria-label={t('skills.detail.close')}
              >
                ×
              </button>
            </div>

            {detailLoading ? (
              <div className="detail-loading">
                <div className="loading-spinner"></div>
                <p>{t('skills.detail.loading')}</p>
              </div>
            ) : (
              <div className="skill-detail-content">
                {/* Summary */}
                <div className="detail-section">
                  <h3>{t('skills.detail.summary')}</h3>
                  <p>{selectedSkill.summary}</p>
                </div>

                {/* Tags */}
                {selectedSkill.tags.length > 0 && (
                  <div className="detail-section">
                    <h3>{t('skills.detail.tags')}</h3>
                    <div className="skill-tags">
                      {selectedSkill.tags.map((tag, index) => (
                        <span
                          key={index}
                          className={`skill-tag ${getTagColor(tag)}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description */}
                <div className="detail-section">
                  <h3>{t('skills.detail.description')}</h3>
                  <p>{selectedSkill.description}</p>
                </div>

                {/* Full Content (SKILL.md) */}
                {selectedSkill.markdown && (
                  <div className="detail-section">
                    <h3>{t('skills.detail.content')}</h3>
                    <pre className="skill-content">{selectedSkill.markdown}</pre>
                  </div>
                )}

                {/* Usage Hint */}
                <div className="detail-section usage-hint">
                  <h3>{t('skills.detail.usage')}</h3>
                  <p className="hint-text">
                    {t('skills.detail.usage.hint')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Workflow Editor Modal */}
      {showWorkflows && (
        <WorkflowEditor onClose={() => setShowWorkflows(false)} />
      )}
    </div>
  );
};

export default SkillsTab;
