import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUpRight, LockKeyhole } from 'lucide-react'
import '@fontsource-variable/geist'
import '@fontsource-variable/manrope'
import './styles.css'
import { profile } from './data/infer'
import { defaultSettings, validateFile } from './data/model'
import type { Dataset, Edits, Settings, Source } from './data/model'
import { loadSample } from './data/samples'
import type { SampleId } from './data/samples'
import { Dashboard } from './ui/Dashboard'
import { ImportPage, ReviewPage } from './ui/ImportFlow'
import { Landing } from './ui/Landing'
import { Brand } from './ui/shared'

type DocumentData = { source: Source; dataset: Dataset; title: string; sample?: SampleId; file?: File; revision: number }
type WorkerResult = { error: string } | { source: Source; dataset: Dataset }
type Route = 'home' | 'import' | 'review' | 'dashboard'

function routeFromHash(): Route {
  const name = window.location.hash.slice(2)
  return name === 'import' || name === 'review' || name === 'dashboard' ? name : 'home'
}

function App() {
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

  function readFile(file: File, sheet?: string) {
    stopRead()
    setError('')
    try {
      validateFile(file.name, file.size)
      const reader = new Worker(new URL('./data/import.worker.ts', import.meta.url), { type: 'module' })
      worker.current = reader
      setBusy(sheet || file.name)
      reader.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (reader !== worker.current) return
        stopRead()
        if ('error' in event.data) {
          setError(event.data.error)
          return
        }
        setEdits({})
        setSettings(defaultSettings)
        setDocumentData({ ...event.data, file, revision: ++revision.current, title: event.data.source.sheet || file.name.replace(/\.[^.]+$/, '') })
        window.location.hash = '/review'
      }
      reader.onerror = () => {
        if (reader !== worker.current) return
        stopRead()
        setError('The file reader stopped unexpectedly. Try a smaller file or save the sheet as CSV.')
      }
      reader.postMessage({ file, sheet })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'This file could not be opened.')
    }
  }

  function updateSchema(nextEdits: Edits, nextSettings: Settings) {
    if (!documentData) return
    setEdits(nextEdits)
    setSettings(nextSettings)
    setDocumentData({
      ...documentData,
      dataset: profile(documentData.source, nextEdits, nextSettings),
      revision: ++revision.current,
    })
  }

  const message = { busy, error, onCancel: stopRead }
  return <>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.querySelector<HTMLElement>('h1')?.focus() }}>Skip to content</a>
    {view === 'home' ? <Landing onSample={chooseSample} /> : <>
      <header className="app-header">
        <div className="app-header-inner"><Brand />
          <div className="app-header-right">
            <span><LockKeyhole size={14} /> Local workspace</span>
            {view !== 'dashboard' && documentData && <a className="button secondary" href="#/dashboard">Dashboard <ArrowUpRight size={15} /></a>}
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

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
