import { useLocale } from '../i18n/index'
import './GuideTab.css'

export default function GuideTab() {
  const { t } = useLocale()

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tocItems = [
    { id: 'guide-overview', key: 's1' },
    { id: 'guide-login', key: 's2' },
    { id: 'guide-layout', key: 's3' },
    { id: 'guide-dept', key: 's4' },
    { id: 'guide-chat', key: 's5' },
    { id: 'guide-bulletin', key: 's6' },
    { id: 'guide-memory', key: 's7' },
    { id: 'guide-cron', key: 's8' },
    { id: 'guide-integ', key: 's9' },
    { id: 'guide-system', key: 's10' },
    { id: 'guide-tips', key: 's11' },
  ]

  return (
    <div className="guide-tab">
      {/* Hero */}
      <div className="guide-hero">
        <h2>{t('guide.title')}</h2>
        <p className="guide-subtitle">{t('guide.subtitle')}</p>
      </div>

      {/* Quick nav pills */}
      <div className="guide-toc">
        {tocItems.map((s, i) => (
          <a key={s.id} className="guide-toc-pill" onClick={() => scrollTo(s.id)}>
            <span className="guide-toc-num">{i + 1}</span>
            {t(`guide.${s.key}.title`)}
          </a>
        ))}
      </div>

      {/* 1. Overview */}
      <div className="guide-section" id="guide-overview">
        <h3><span className="guide-icon">1</span> {t('guide.s1.title')}</h3>
        <p>{t('guide.s1.p1')}</p>
        <div className="guide-feature-grid">
          <div className="guide-feature-card">
            <h4>{t('guide.s1.f1.title')}</h4>
            <p>{t('guide.s1.f1.desc')}</p>
          </div>
          <div className="guide-feature-card">
            <h4>{t('guide.s1.f2.title')}</h4>
            <p>{t('guide.s1.f2.desc')}</p>
          </div>
          <div className="guide-feature-card">
            <h4>{t('guide.s1.f3.title')}</h4>
            <p>{t('guide.s1.f3.desc')}</p>
          </div>
          <div className="guide-feature-card">
            <h4>{t('guide.s1.f4.title')}</h4>
            <p>{t('guide.s1.f4.desc')}</p>
          </div>
        </div>
      </div>

      {/* 2. Login */}
      <div className="guide-section" id="guide-login">
        <h3><span className="guide-icon">2</span> {t('guide.s2.title')}</h3>
        <div className="guide-step">
          <span className="guide-step-num">1</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s2.step1') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">2</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s2.step2') }} />
        </div>
        <div className="guide-tip">
          <strong>{t('guide.tip')}</strong> {t('guide.s2.tip')}
        </div>
      </div>

      {/* 3. Layout */}
      <div className="guide-section" id="guide-layout">
        <h3><span className="guide-icon">3</span> {t('guide.s3.title')}</h3>
        <p>{t('guide.s3.p1')}</p>
        <div className="guide-layout-grid">
          <div className="guide-layout-item" data-label="A">
            <span dangerouslySetInnerHTML={{ __html: t('guide.s3.area.top') }} />
          </div>
          <div className="guide-layout-item" data-label="B">
            <span dangerouslySetInnerHTML={{ __html: t('guide.s3.area.left') }} />
          </div>
          <div className="guide-layout-item" data-label="C">
            <span dangerouslySetInnerHTML={{ __html: t('guide.s3.area.right') }} />
          </div>
          <div className="guide-layout-item" data-label="D">
            <span dangerouslySetInnerHTML={{ __html: t('guide.s3.area.bottom') }} />
          </div>
        </div>
      </div>

      {/* 4. Departments */}
      <div className="guide-section" id="guide-dept">
        <h3><span className="guide-icon">4</span> {t('guide.s4.title')}</h3>
        <p>{t('guide.s4.p1')}</p>
        <div className="guide-step">
          <span className="guide-step-num">1</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s4.step1') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">2</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s4.step2') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">3</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s4.step3') }} />
        </div>
        <div className="guide-tip">
          <strong>{t('guide.tip')}</strong> {t('guide.s4.tip')}
        </div>
      </div>

      {/* 5. Chat (highlighted as core feature) */}
      <div className="guide-section guide-section-highlight" id="guide-chat">
        <h3><span className="guide-icon">5</span> {t('guide.s5.title')}</h3>
        <p>{t('guide.s5.p1')}</p>
        <div className="guide-step">
          <span className="guide-step-num">1</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s5.step1') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">2</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s5.step2') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">3</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s5.step3') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">4</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s5.step4') }} />
        </div>
        <div className="guide-tip">
          <strong>{t('guide.tip')}</strong> {t('guide.s5.tip')}
        </div>
      </div>

      {/* 6. Bulletin */}
      <div className="guide-section" id="guide-bulletin">
        <h3><span className="guide-icon">6</span> {t('guide.s6.title')}</h3>
        <p>{t('guide.s6.p1')}</p>
        <div className="guide-step">
          <span className="guide-step-num">1</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s6.step1') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">2</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s6.step2') }} />
        </div>
      </div>

      {/* 7. Memory */}
      <div className="guide-section" id="guide-memory">
        <h3><span className="guide-icon">7</span> {t('guide.s7.title')}</h3>
        <p>{t('guide.s7.p1')}</p>
        <div className="guide-step">
          <span className="guide-step-num">1</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s7.step1') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">2</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s7.step2') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">3</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s7.step3') }} />
        </div>
      </div>

      {/* 8. Cron */}
      <div className="guide-section" id="guide-cron">
        <h3><span className="guide-icon">8</span> {t('guide.s8.title')}</h3>
        <p>{t('guide.s8.p1')}</p>
        <div className="guide-step">
          <span className="guide-step-num">1</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s8.step1') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">2</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s8.step2') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">3</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s8.step3') }} />
        </div>
      </div>

      {/* 9. Integrations */}
      <div className="guide-section" id="guide-integ">
        <h3><span className="guide-icon">9</span> {t('guide.s9.title')}</h3>
        <p>{t('guide.s9.p1')}</p>
        <div className="guide-feature-grid">
          <div className="guide-feature-card">
            <h4>{t('guide.s9.f1.title')}</h4>
            <p>{t('guide.s9.f1.desc')}</p>
          </div>
          <div className="guide-feature-card">
            <h4>{t('guide.s9.f2.title')}</h4>
            <p>{t('guide.s9.f2.desc')}</p>
          </div>
          <div className="guide-feature-card">
            <h4>{t('guide.s9.f3.title')}</h4>
            <p>{t('guide.s9.f3.desc')}</p>
          </div>
          <div className="guide-feature-card">
            <h4>{t('guide.s9.f4.title')}</h4>
            <p>{t('guide.s9.f4.desc')}</p>
          </div>
        </div>
        <div className="guide-tip">
          <strong>{t('guide.tip')}</strong> {t('guide.s9.tip')}
        </div>
      </div>

      {/* 10. System */}
      <div className="guide-section" id="guide-system">
        <h3><span className="guide-icon">10</span> {t('guide.s10.title')}</h3>
        <p>{t('guide.s10.p1')}</p>
        <div className="guide-step">
          <span className="guide-step-num">1</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s10.step1') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">2</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s10.step2') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">3</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s10.step3') }} />
        </div>
      </div>

      {/* 11. Tips */}
      <div className="guide-section" id="guide-tips">
        <h3><span className="guide-icon">11</span> {t('guide.s11.title')}</h3>
        <div className="guide-tips-grid">
          <div className="guide-tip-card">
            <strong>{t('guide.s11.t1.title')}</strong>
            <span>{t('guide.s11.t1.desc')}</span>
          </div>
          <div className="guide-tip-card">
            <strong>{t('guide.s11.t2.title')}</strong>
            <span>{t('guide.s11.t2.desc')}</span>
          </div>
          <div className="guide-tip-card">
            <strong>{t('guide.s11.t3.title')}</strong>
            <span>{t('guide.s11.t3.desc')}</span>
          </div>
          <div className="guide-tip-card">
            <strong>{t('guide.s11.t4.title')}</strong>
            <span>{t('guide.s11.t4.desc')}</span>
          </div>
          <div className="guide-tip-card">
            <strong>{t('guide.s11.t5.title')}</strong>
            <span>{t('guide.s11.t5.desc')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
