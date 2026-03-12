import { useLocale } from '../i18n/index'
import './GuideTab.css'

export default function GuideTab() {
  const { t } = useLocale()

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="guide-tab">
      <h2>{t('guide.title')}</h2>
      <div className="guide-subtitle">{t('guide.subtitle')}</div>

      {/* Table of contents */}
      <div className="guide-toc">
        <h3>{t('guide.toc')}</h3>
        <ol>
          <li><a onClick={() => scrollTo('guide-overview')}>{t('guide.s1.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-login')}>{t('guide.s2.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-layout')}>{t('guide.s3.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-dept')}>{t('guide.s4.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-chat')}>{t('guide.s5.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-bulletin')}>{t('guide.s6.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-memory')}>{t('guide.s7.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-cron')}>{t('guide.s8.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-integ')}>{t('guide.s9.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-system')}>{t('guide.s10.title')}</a></li>
          <li><a onClick={() => scrollTo('guide-tips')}>{t('guide.s11.title')}</a></li>
        </ol>
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
        <div className="guide-step">
          <span className="guide-step-num">A</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s3.area.top') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">B</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s3.area.left') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">C</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s3.area.right') }} />
        </div>
        <div className="guide-step">
          <span className="guide-step-num">D</span>
          <span className="guide-step-text" dangerouslySetInnerHTML={{ __html: t('guide.s3.area.bottom') }} />
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

      {/* 5. Chat */}
      <div className="guide-section" id="guide-chat">
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
        <div className="guide-tip">
          <strong>{t('guide.s11.t1.title')}</strong> {t('guide.s11.t1.desc')}
        </div>
        <div className="guide-tip">
          <strong>{t('guide.s11.t2.title')}</strong> {t('guide.s11.t2.desc')}
        </div>
        <div className="guide-tip">
          <strong>{t('guide.s11.t3.title')}</strong> {t('guide.s11.t3.desc')}
        </div>
        <div className="guide-tip">
          <strong>{t('guide.s11.t4.title')}</strong> {t('guide.s11.t4.desc')}
        </div>
        <div className="guide-tip">
          <strong>{t('guide.s11.t5.title')}</strong> {t('guide.s11.t5.desc')}
        </div>
      </div>
    </div>
  )
}
