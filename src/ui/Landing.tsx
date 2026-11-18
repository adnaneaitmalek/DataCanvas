import { ArrowDown, ArrowRight, ChartNoAxesCombined, FileSpreadsheet, LockKeyhole, ScanLine } from 'lucide-react'
import type { SampleId } from '../data/samples'
import { DashboardPreview } from './Dashboard'
import { Brand, SampleGrid } from './shared'

const steps = [
  { icon: FileSpreadsheet, title: 'Import a file', detail: 'Open a CSV, TSV, or Excel workbook from your device.' },
  { icon: ScanLine, title: 'Review columns', detail: 'Check the detected dates, measures, and categories.' },
  { icon: ChartNoAxesCombined, title: 'Explore the data', detail: 'Filter your dashboard, inspect rows, and export results.' },
]

export function Landing({ onSample }: { onSample: (sample: SampleId) => void }) {
  return <>
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#sample-data">Sample data</a></nav>
        <a className="button secondary nav-action" href="#/import">Open workspace <ArrowRight size={15} /></a>
      </div>
    </header>
    <main id="main">
      <section className="hero" data-enter>
        <div className="hero-copy">
          <span className="privacy-tag"><LockKeyhole size={14} /> Private by default</span>
          <h1 tabIndex={-1}>From spreadsheet<br />to <span>dashboard.</span></h1>
          <p>Turn a CSV, TSV, or Excel sheet into an interactive dashboard you can filter, explore, and export.</p>
          <div className="hero-actions">
            <a href="#/import" className="button primary">Start analyzing <ArrowRight size={18} /></a>
            <button type="button" className="button secondary" onClick={() => onSample('sales')}><ChartNoAxesCombined size={18} /> Try sample data</button>
          </div>
        </div>
        <div className="hero-visual" data-visual>
          <div className="hero-grid" aria-hidden="true" />
          <div className="preview-frame"><DashboardPreview /></div>
        </div>
      </section>
      <section id="how-it-works" className="landing-section method">
        <div className="section-heading"><h2>How it works</h2><p>From a file on your device to a dashboard in three steps.</p></div>
        <ol className="method-list">
          {steps.map(({ icon: Icon, title, detail }) => <li key={title}><span className="sample-icon"><Icon size={22} /></span><h3>{title}</h3><p>{detail}</p></li>)}
        </ol>
        <a href="#sample-data" className="quiet-link">See sample dashboards <ArrowDown size={15} /></a>
      </section>
      <section id="sample-data" className="landing-section landing-samples">
        <div className="section-heading"><h2>Explore sample data</h2><p>Open any dataset to see what its dashboard can show you.</p></div>
        <SampleGrid onSample={onSample} />
      </section>
    </main>
    <footer className="site-footer">
      <div><Brand /><span><LockKeyhole size={14} /> Data stays on your device.</span></div>
    </footer>
  </>
}
