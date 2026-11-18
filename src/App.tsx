import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, LockKeyhole } from 'lucide-react'
import { profile } from './data/infer'
import { defaultSettings, validateFile } from './data/model'
import type { WorkRequest, WorkResult } from './data/import.worker'
import type { Dataset, Edits, Settings, Source } from './data/model'
import { loadSample } from './data/samples'
import type { SampleId } from './data/samples'
import { Dashboard } from './ui/Dashboard'
import { ImportPage, ReviewPage } from './ui/ImportFlow'
import { Landing } from './ui/Landing'
import { Brand } from './ui/shared'

type DocumentData = { source: Source; dataset: Dataset; title: string; sample?: SampleId; file?: File; revision: number }
type Route = 'home' | 'import' | 'review' | 'dashboard'

function routeFromHash(): Route {
  const name = window.location.hash.slice(2)
  return name === 'import' || name === 'review' || name === 'dashboard' ? name : 'home'
}

export function App() {
  const [route, setRoute] = useState(routeFromHash)
  const [documentData, setDocumentData] = useState<DocumentData>()
  const [edits, setEdits] = useState<Edits>({})
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const worker = useRef<Worker | undefined>(undefined)
  const revision = useRef(0)
  const previousRoute = useRef<Route | undefined>(undefined)
  const view = (route === 'review' || route === 'dashboard') && !documentData ? 'import' : route

  const stopRead = useCallback(() => {
    worker.current?.terminate()
    worker.current = undefined
    setBusy('')
  }, [])

  useEffect(() => {
    const changed = () => {
      const next = routeFromHash()
      if (next !== previousRoute.current) {
        stopRead()
        setError('')
      }
      setRoute(next)
    }
    window.addEventListener('hashchange', changed)
    return () => {
      window.removeEventListener('hashchange', changed)
      worker.current?.terminate()
    }
  }, [stopRead])

  useEffect(() => {
    const previous = previousRoute.current
    previousRoute.current = route
    if (previous === undefined) return
    if (view !== 'home' || window.location.hash === '#/') window.scrollTo(0, 0)
    if (view !== 'home') document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
    if (view === 'home' && !window.location.hash.startsWith('#/')) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
    }
  }, [route, view])

  function chooseSample(id: SampleId) {
    stopRead()
    setError('')
    setEdits({})
    setSettings(defaultSettings)
    setDocumentData({ ...loadSample(id), revision: ++revision.current })
    window.location.hash = '/dashboard'
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

  function readFile(file: File, sheet?: string) {
    try {
      validateFile(file.name, file.size)
    } catch (problem) {
      stopRead()
      setError(problem instanceof Error ? problem.message : 'This file could not be opened.')
      return
    }
    runWorker({ kind: 'import', file, sheet }, `Reading ${sheet || file.name}`, ({ source, dataset }) => {
      if (!source) return
      setEdits({})
      setSettings(defaultSettings)
      setDocumentData({ source, dataset, file, revision: ++revision.current, title: source.sheet || file.name.replace(/\.[^.]+$/, '') })
      window.location.hash = '/review'
    })
  }

  function updateSchema(nextEdits: Edits, nextSettings: Settings) {
    if (!documentData) return
    const { source } = documentData
    const apply = (dataset: Dataset) => {
      setEdits(nextEdits)
      setSettings(nextSettings)
      setDocumentData({ ...documentData, dataset, revision: ++revision.current })
    }
    if (source.rows.length * source.headers.length > 30_000) {
      runWorker({ kind: 'profile', source, edits: nextEdits, settings: nextSettings }, 'Checking column types', result => apply(result.dataset))
    } else {
      setError('')
      apply(profile(source, nextEdits, nextSettings))
    }
  }

  const message = { busy, error, onCancel: stopRead }
  return <>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.querySelector<HTMLElement>('#main h1')?.focus() }}>Skip to content</a>
    {view === 'home' ? <Landing onSample={chooseSample} /> : <>
      <header className={view === 'dashboard' ? 'app-header app-header-wide' : 'app-header'}>
        <div className="app-header-inner"><Brand />
          <div className="app-header-right">
            <span><LockKeyhole size={14} /> Local workspace</span>
            {view === 'import' && documentData && <a className="button secondary" href="#/dashboard">Dashboard <ArrowUpRight size={15} /></a>}
          </div>
        </div>
      </header>
      {view === 'import' && <ImportPage onFile={readFile} onSample={chooseSample} {...message} />}
      {view === 'review' && documentData && <ReviewPage source={documentData.source} dataset={documentData.dataset} edits={edits} settings={settings}
        onUpdate={updateSchema} onContinue={() => { window.location.hash = '/dashboard' }}
        onSheet={sheet => { if (documentData.file) readFile(documentData.file, sheet) }} {...message} />}
      {view === 'dashboard' && documentData && <Dashboard key={documentData.revision} source={documentData.source}
        dataset={documentData.dataset} sample={Boolean(documentData.sample)} title={documentData.title} />}
    </>}
  </>
}
