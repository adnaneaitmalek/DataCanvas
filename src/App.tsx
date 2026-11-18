import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, LockKeyhole } from 'lucide-react'
import { initialAnalysis, reconcileAnalysis } from './data/analysisState'
import type { AnalysisState } from './data/analysisState'
import { profile } from './data/infer'
import { defaultSettings, validateFile } from './data/model'
import type { WorkRequest, WorkResult } from './data/import.worker'
import type { Dataset, Delimiter, Edits, Settings, Source } from './data/model'
import { loadSample } from './data/samples'
import type { SampleId } from './data/samples'
import { Dashboard } from './ui/Dashboard'
import { ImportPage, ReviewPage } from './ui/ImportFlow'
import { Landing } from './ui/Landing'
import { Brand, WorkspaceLink } from './ui/shared'

type Spreadsheet = {
  source: Source; dataset: Dataset; title: string; sample?: SampleId; file?: File;
  edits: Edits; settings: Settings
}
type DocumentData = Spreadsheet & { id: string; analysis: AnalysisState; hasDashboard: boolean }
type Route = 'home' | 'import' | 'review' | 'dashboard'
type Location = { route: Route; hash: string; id: string | undefined }

function readLocation(): Location {
  const hash = window.location.hash
  const name = hash.startsWith('#/') ? hash.slice(2) : ''
  const route = name === 'import' || name === 'review' || name === 'dashboard' ? name : 'home'
  const id: unknown = window.history.state?.dataCanvasSession
  return { route, hash, id: typeof id === 'string' ? id : undefined }
}

function sessionId() {
  return crypto.getRandomValues(new Uint32Array(4)).join('-')
}

export function App() {
  const [location, setLocation] = useState(readLocation)
  const [documentData, setDocumentData] = useState<DocumentData>()
  const [draft, setDraft] = useState<Spreadsheet>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [recovering, setRecovering] = useState(false)
  const worker = useRef<Worker | undefined>(undefined)
  const lastLocation = useRef(location)
  const previousView = useRef<Location | undefined>(undefined)
  const { route, hash, id } = location
  const needsDocument = route === 'review' || route === 'dashboard'
  const lostSession = needsDocument && !documentData
  const replaced = needsDocument && Boolean(documentData && id !== documentData.id)
  const view = lostSession || replaced ? 'import' : route
  const review = draft ?? documentData

  const stopRead = useCallback(() => {
    worker.current?.terminate()
    worker.current = undefined
    setBusy('')
  }, [])

  const followLocation = useCallback(() => {
    const next = readLocation()
    const previous = lastLocation.current
    if (next.hash === previous.hash && next.id === previous.id) return
    lastLocation.current = next
    stopRead()
    setError('')
    if (next.route !== 'review' || next.id !== previous.id) setDraft(undefined)
    setLocation(next)
  }, [stopRead])

  const navigate = useCallback((next: Exclude<Route, 'home'>, nextId?: string, replace = false) => {
    const nextHash = `#/${next}`
    if (lastLocation.current.hash === nextHash && lastLocation.current.id === nextId) return
    const state = nextId ? { dataCanvasSession: nextId } : null
    if (replace) window.history.replaceState(state, '', nextHash)
    else window.history.pushState(state, '', nextHash)
    followLocation()
  }, [followLocation])

  useEffect(() => {
    if (!lostSession) return
    setRecovering(true)
    navigate('import', undefined, true)
  }, [lostSession, navigate])

  useEffect(() => {
    window.addEventListener('hashchange', followLocation)
    window.addEventListener('popstate', followLocation)
    return () => {
      window.removeEventListener('hashchange', followLocation)
      window.removeEventListener('popstate', followLocation)
      worker.current?.terminate()
    }
  }, [followLocation])

  useEffect(() => {
    const previous = previousView.current
    previousView.current = location
    if (previous === undefined) return
    if (view !== 'home' || hash === '#/') window.scrollTo(0, 0)
    if (view !== 'home') document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
    if (view === 'home' && !hash.startsWith('#/')) {
      document.getElementById(hash.slice(1))?.scrollIntoView()
    }
  }, [location, hash, view])

  function chooseSample(id: SampleId) {
    const sample = loadSample(id)
    const nextId = sessionId()
    setRecovering(false)
    setDocumentData({
      ...sample, id: nextId, edits: {}, settings: defaultSettings, analysis: initialAnalysis(sample.dataset), hasDashboard: true,
    })
    navigate('dashboard', nextId)
  }

  function runWorker(job: WorkRequest, label: string, accept: (result: Exclude<WorkResult, { error: string }>) => void) {
    stopRead()
    setError('')
    try {
      const reader = new Worker(new URL('./data/import.worker.ts', import.meta.url), { type: 'module' })
      worker.current = reader
      setBusy(label)
      reader.onmessage = (event: MessageEvent<WorkResult>) => {
        if (reader !== worker.current) return
        stopRead()
        if ('error' in event.data) {
          setError(event.data.error)
          return
        }
        accept(event.data)
      }
      reader.onerror = () => {
        if (reader !== worker.current) return
        stopRead()
        setError('Processing stopped unexpectedly. Try a smaller sheet or import it as CSV.')
      }
      reader.postMessage(job)
    } catch (problem) {
      stopRead()
      setError(problem instanceof Error ? problem.message : 'Processing could not be started.')
    }
  }

  function readFile(file: File, sheet?: string, delimiter?: Delimiter) {
    try {
      validateFile(file.name, file.size)
    } catch (problem) {
      stopRead()
      setError(problem instanceof Error ? problem.message : 'This file could not be opened.')
      return
    }
    const previous = (sheet !== undefined || delimiter !== undefined) && documentData?.file === file ? documentData : undefined
    const sameLayout = previous && (sheet !== undefined ? previous.source.sheet === sheet : previous.source.dialect?.delimiter === delimiter)
    const edits = sameLayout ? previous.edits : {}
    const settings = (sameLayout ? previous.settings : delimiter ? review?.settings : undefined) ?? defaultSettings
    runWorker({ kind: 'import', file, sheet, delimiter, edits, settings }, `Reading ${sheet || file.name}`, ({ source, dataset }) => {
      if (!source) return
      const imported = { source, dataset, file, edits, settings, title: source.sheet || file.name.replace(/\.[^.]+$/, '') }
      if (previous) {
        setDraft(imported)
      } else {
        const nextId = sessionId()
        setRecovering(false)
        setDocumentData({ ...imported, id: nextId, hasDashboard: false, analysis: initialAnalysis(dataset) })
        navigate('review', nextId)
      }
    })
  }

  function updateSchema(nextEdits: Edits, nextSettings: Settings) {
    if (!review) return
    const { source } = review
    const apply = (dataset: Dataset) => {
      setDraft({ ...review, dataset, edits: nextEdits, settings: nextSettings })
    }
    if (source.rows.length * source.headers.length > 30_000) {
      runWorker({ kind: 'profile', source, edits: nextEdits, settings: nextSettings }, 'Checking column types', result => apply(result.dataset))
    } else {
      setError('')
      apply(profile(source, nextEdits, nextSettings))
    }
  }

  function buildDashboard() {
    if (!documentData || !review || worker.current || review.source.dialect?.ambiguous.length) return
    const changedSheet = documentData.source.sheet !== review.source.sheet
    const reparsed = changedSheet || documentData.source.dialect?.delimiter !== review.source.dialect?.delimiter
    const analysis = !documentData.hasDashboard ? initialAnalysis(review.dataset) : !draft ? documentData.analysis
      : reconcileAnalysis(documentData.dataset, review.dataset, documentData.analysis, reparsed)
    const nextId = changedSheet && documentData.hasDashboard ? sessionId() : documentData.id
    setDocumentData({ ...review, id: nextId, analysis, hasDashboard: true })
    navigate('dashboard', nextId)
  }

  const message = { busy, error, onCancel: stopRead }
  return <>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.querySelector<HTMLElement>('#main h1')?.focus() }}>Skip to content</a>
    {view === 'home' ? <Landing onSample={chooseSample} /> : <>
      <header className={view === 'dashboard' ? 'app-header app-header-wide' : 'app-header'}>
        <div className="app-header-inner"><Brand />
          <div className="app-header-right">
            <span><LockKeyhole size={14} /> Local workspace</span>
            {view === 'import' && documentData?.hasDashboard && <WorkspaceLink route="dashboard" onFollow={() => navigate('dashboard', documentData.id)}>
              Current dashboard <ArrowUpRight size={15} />
            </WorkspaceLink>}
          </div>
        </div>
      </header>
      {view === 'import' && <ImportPage recovering={recovering || lostSession} replaced={replaced} onFile={readFile} onSample={chooseSample} {...message} />}
      {view === 'review' && review && <ReviewPage source={review.source} dataset={review.dataset} edits={review.edits} settings={review.settings}
        onUpdate={updateSchema} onContinue={buildDashboard}
        onDelimiter={delimiter => { if (review.file) readFile(review.file, undefined, delimiter) }}
        onSheet={sheet => { if (review.file) readFile(review.file, sheet) }} {...message} />}
      {view === 'dashboard' && documentData && <Dashboard key={documentData.id} source={documentData.source}
        dataset={documentData.dataset} sample={Boolean(documentData.sample)} title={documentData.title} analysis={documentData.analysis}
        onReview={() => navigate('review', documentData.id)}
        onAnalysis={patch => setDocumentData(current => current && { ...current, analysis: { ...current.analysis, ...patch } })} />}
    </>}
  </>
}
