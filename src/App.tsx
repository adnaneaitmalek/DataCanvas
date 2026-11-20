import { useCallback, useEffect, useRef, useState } from 'react'
import { initialAnalysis, reconcileAnalysis } from './data/analysisState'
import { importReview } from './data/importReview'
import { profile } from './data/infer'
import { fileFingerprint } from './data/fileIdentity'
import { summarizeWorkspace } from './data/workspaceStore'
import { defaultSettings, validateFile } from './data/model'
import type { WorkRequest, WorkResult } from './data/import.worker'
import type { Dataset, Delimiter, Edits, Settings } from './data/model'
import { loadSample } from './data/samples'
import type { SampleId } from './data/samples'
import type { Spreadsheet, Workspace, WorkspaceSummary } from './data/workspaceStore'
import { Dashboard } from './ui/Dashboard'
import { ImportPage, ReviewPage } from './ui/ImportFlow'
import { Landing } from './ui/Landing'
import { SiteHeader, WorkspaceList } from './ui/Workspaces'
import { useWorkspaces } from './ui/useWorkspaces'
import { useNavigationMotion } from './ui/useNavigationMotion'

type Route = 'home' | 'import' | 'review' | 'dashboard' | 'recover'
type EditEntry = 'open' | 'closed'
type Location = { route: Route; hash: string; id: string | undefined; edit: EditEntry | undefined }

function readLocation(): Location {
  const hash = window.location.hash
  const name = hash.startsWith('#/') ? hash.slice(2) : ''
  const route = name === 'import' || name === 'review' || name === 'dashboard' || name === 'recover' ? name : 'home'
  const id: unknown = window.history.state?.dataCanvasSession
  const edit: unknown = window.history.state?.dataCanvasEdit
  return { route, hash, id: typeof id === 'string' ? id : undefined, edit: edit === 'open' || edit === 'closed' ? edit : undefined }
}

function sessionId() {
  return crypto.getRandomValues(new Uint32Array(4)).join('-')
}

export function App() {
  const [location, setLocation] = useState(readLocation)
  const [documentData, setDocumentData] = useState<Workspace>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [openedImport, setOpenedImport] = useState<{ id: string; automatic: boolean; reopened?: boolean }>()
  const { workspaces, storageError, save, read, findFile, remove } = useWorkspaces()
  const worker = useRef<Worker | undefined>(undefined)
  const reading = useRef(0)
  const saved = useRef<Workspace | undefined>(undefined)
  const closingReview = useRef(false)
  const lastLocation = useRef(location)
  const previousView = useRef<Location | undefined>(undefined)
  const { route, hash, id, edit } = location
  const needsDocument = route === 'review' || route === 'dashboard'
  const restoring = needsDocument && (!id || id !== documentData?.id)
  const view = restoring ? 'loading' : route
  const review = documentData?.draft ?? documentData
  const prepareNavigation = useNavigationMotion(view, id)

  useEffect(() => {
    const title = view === 'home' ? 'Spreadsheet dashboards' : view === 'dashboard' ? documentData?.title
      : view === 'review' ? `Column settings · ${review?.title ?? 'Import'}`
        : view === 'recover' ? 'Reopen a workspace' : view === 'loading' ? 'Opening workspace' : 'Import'
    document.title = view === 'home' ? 'DataCanvas · Spreadsheet dashboards' : `${title} · DataCanvas`
  }, [view, documentData?.title, review?.title])

  const stopRead = useCallback(() => {
    reading.current++
    worker.current?.terminate()
    worker.current = undefined
    setBusy('')
  }, [])

  const followLocation = useCallback(() => {
    const next = readLocation()
    const previous = lastLocation.current
    if (next.hash === previous.hash && next.id === previous.id && next.edit === previous.edit) return
    lastLocation.current = next
    closingReview.current = false
    // Forward can revisit the slot where an editor was closed. Back from that
    // slot passes its original dashboard entry as part of the same workspace.
    if (previous.edit === 'closed' && next.route === 'dashboard' && next.id === previous.id && !next.edit) {
      window.history.back()
      return
    }
    stopRead()
    setError('')
    // Table scrolling updates a lightweight position object outside React.
    if (previous.route === 'dashboard') setDocumentData(current => current && { ...current })
    prepareNavigation()
    setLocation(next)
  }, [prepareNavigation, stopRead])

  const navigate = useCallback((next: Exclude<Route, 'home'>, nextId?: string, replace = false, nextEdit?: EditEntry) => {
    const nextHash = `#/${next}`
    if (lastLocation.current.hash === nextHash && lastLocation.current.id === nextId && lastLocation.current.edit === nextEdit) return
    const state = { dataCanvasSession: nextId, dataCanvasEdit: nextEdit }
    if (replace) window.history.replaceState(state, '', nextHash)
    else window.history.pushState(state, '', nextHash)
    followLocation()
  }, [followLocation])

  useEffect(() => {
    if (!documentData || saved.current === documentData) return
    const previous = saved.current
    saved.current = documentData
    save(documentData, previous?.id !== documentData.id || previous.contentRevision !== documentData.contentRevision)
  }, [documentData, save])

  useEffect(() => {
    if (!restoring) return
    let active = true
    if (id) {
      read(id).then(workspace => {
        if (!active || lastLocation.current.id !== id) return
        if (workspace) {
          saved.current = workspace
          setDocumentData(workspace)
        } else navigate('recover', undefined, true)
      }).catch(() => { if (active && lastLocation.current.id === id) navigate('recover', undefined, true) })
    } else {
      navigate('recover', undefined, true)
    }
    return () => { active = false }
  }, [id, navigate, read, restoring])

  useEffect(() => {
    if (restoring || !documentData || !id) return
    if (route === 'dashboard' && !documentData.hasDashboard) navigate('review', id, true)
    if (route === 'review' && documentData.hasDashboard && !edit) navigate('dashboard', id, true)
  }, [documentData, edit, id, navigate, restoring, route])

  useEffect(() => {
    window.addEventListener('hashchange', followLocation)
    window.addEventListener('popstate', followLocation)
    return () => {
      window.removeEventListener('hashchange', followLocation)
      window.removeEventListener('popstate', followLocation)
      stopRead()
    }
  }, [followLocation, stopRead])

  useEffect(() => {
    const previous = previousView.current
    previousView.current = location
    if (previous === undefined || view === 'loading') return
    if (view !== 'home' || hash === '#/') window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    if (view !== 'home') {
      const returnFromEdit = view === 'dashboard' && previous.edit === 'open'
      const target = returnFromEdit
        ? document.querySelector<HTMLElement>('.table-panel .table-scroll') ??
          document.querySelector<HTMLElement>('.workspace-actions [href="#/review"]')
        : document.querySelector<HTMLElement>('h1')
      target?.focus({ preventScroll: true })
    }
    if (view === 'home') {
      if (hash.startsWith('#/') || !hash) document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
      else {
        const section = document.getElementById(hash.slice(1))
        section?.scrollIntoView()
        section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
      }
    }
  }, [location, hash, view])

  function chooseSample(id: SampleId) {
    const existing = workspaces.find(workspace => workspace.sample === id)
    if (existing) {
      openWorkspace(existing)
      return
    }
    const sample = loadSample(id)
    const nextId = sessionId()
    setDocumentData({
      ...sample, id: nextId, contentRevision: nextId, edits: {}, settings: defaultSettings, analysis: initialAnalysis(sample.dataset), hasDashboard: true, tablePosition: {},
    })
    navigate('dashboard', nextId)
  }

  function openWorkspace(workspace: WorkspaceSummary) {
    const next = workspace.hasDashboard ? 'dashboard' : 'review'
    navigate(next, workspace.id, edit === 'open')
  }

  function runWorker(job: WorkRequest, label: string, accept: (result: Extract<WorkResult, { dataset: Dataset }>) => void) {
    stopRead()
    setError('')
    try {
      const reader = new Worker(new URL('./data/import.worker.ts', import.meta.url), { type: 'module' })
      worker.current = reader
      setBusy(label)
      reader.onmessage = (event: MessageEvent<WorkResult>) => {
        if (reader !== worker.current) return
        if ('progress' in event.data) {
          setBusy(event.data.progress)
          return
        }
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

  async function readFile(file: File, sheet?: string, delimiter?: Delimiter) {
    try {
      validateFile(file.name, file.size)
    } catch (problem) {
      stopRead()
      setError(problem instanceof Error ? problem.message : 'This file could not be opened.')
      return
    }
    const previous = sheet !== undefined || delimiter !== undefined ? documentData : undefined
    const sameLayout = previous && (sheet !== undefined ? previous.source.sheet === sheet : previous.source.dialect?.delimiter === delimiter)
    const edits = sameLayout ? previous.edits : {}
    const settings = (sameLayout ? previous.settings : delimiter ? review?.settings : undefined) ?? defaultSettings
    let fingerprint = previous?.fingerprint
    if (!previous) {
      stopRead()
      const version = reading.current
      setError('')
      setBusy('Checking saved files')
      try {
        fingerprint = await fileFingerprint(file)
        if (reading.current !== version) return
        const existing = documentData?.fingerprint === fingerprint ? summarizeWorkspace(documentData) : await findFile(fingerprint)
        if (reading.current !== version) return
        if (existing) {
          stopRead()
          setOpenedImport({ id: existing.id, automatic: false, reopened: true })
          openWorkspace(existing)
          return
        }
      } catch (problem) {
        if (reading.current !== version) return
        stopRead()
        setError(problem instanceof Error ? problem.message : 'The file could not be checked.')
        return
      }
    }
    runWorker({ kind: 'import', file, sheet, delimiter, edits, settings }, `Reading ${sheet || file.name}`, ({ source, dataset }) => {
      if (!source) return
      const imported: Spreadsheet = { source, dataset, file, edits, settings, title: source.sheet || file.name.replace(/\.[^.]+$/, '') }
      if (previous) {
        const contentRevision = sessionId()
        setDocumentData(current => current?.id === previous.id ? { ...current, contentRevision, draft: imported } : current)
      } else {
        const nextId = sessionId()
        const automatic = !importReview(source, dataset).required
        if (automatic) setOpenedImport({ id: nextId, automatic })
        setDocumentData({ ...imported, id: nextId, fingerprint, contentRevision: nextId, hasDashboard: automatic, analysis: initialAnalysis(dataset), tablePosition: {} })
        navigate(automatic ? 'dashboard' : 'review', nextId)
      }
    })
  }

  function updateSchema(nextEdits: Edits, nextSettings: Settings) {
    if (!review) return
    const { source, title, file, sample } = review
    const apply = (dataset: Dataset) => {
      const contentRevision = sessionId()
      setDocumentData(current => current && { ...current, contentRevision, draft: { source, title, file, sample, dataset, edits: nextEdits, settings: nextSettings } })
    }
    if (source.rows.length * source.headers.length > 30_000) {
      runWorker({ kind: 'profile', source, edits: nextEdits, settings: nextSettings }, 'Checking column types', result => apply(result.dataset))
    } else {
      setError('')
      apply(profile(source, nextEdits, nextSettings))
    }
  }

  function buildDashboard() {
    if (!documentData || !review || closingReview.current || worker.current || importReview(review.source, review.dataset).blocked) return
    const changedSheet = documentData.source.sheet !== review.source.sheet
    const reparsed = changedSheet || documentData.source.dialect?.delimiter !== review.source.dialect?.delimiter
    const analysis = !documentData.hasDashboard ? initialAnalysis(review.dataset) : !documentData.draft ? documentData.analysis
      : reconcileAnalysis(documentData.dataset, review.dataset, documentData.analysis, reparsed)
    const { source, dataset, title, sample, file, edits, settings } = review
    setDocumentData({ source, dataset, title, sample, file, edits, settings, id: documentData.id,
      fingerprint: documentData.fingerprint,
      contentRevision: documentData.draft ? sessionId() : documentData.contentRevision,
      analysis, hasDashboard: true, tablePosition: documentData.tablePosition })
    if (edit === 'open') closeEditor(false)
    else {
      setOpenedImport({ id: documentData.id, automatic: false })
      navigate('dashboard', documentData.id, true)
    }
  }

  function closeEditor(discard = true) {
    if (closingReview.current) return
    closingReview.current = true
    if (edit === 'open') {
      if (discard && documentData?.draft) {
        const contentRevision = sessionId()
        setDocumentData(current => current && { ...current, contentRevision, draft: undefined })
      }
      window.history.replaceState({ dataCanvasSession: id, dataCanvasEdit: 'closed' }, '', '#/dashboard')
    }
    window.history.back()
  }

  const message = { busy, error, onCancel: stopRead }
  const headerWorkspace = !restoring && documentData ? documentData : workspaces.find(workspace => workspace.id === id)
  return <>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.querySelector<HTMLElement>('#main h1')?.focus() }}>Skip to content</a>
    <SiteHeader view={restoring ? route : view} workspaces={workspaces} activeId={id} workspace={headerWorkspace}
      onOpen={openWorkspace} onLibrary={() => navigate('import', undefined, edit === 'open')}
      onResume={() => {
        if (!headerWorkspace) return
        if (edit === 'open') window.history.back()
        else navigate(headerWorkspace.hasDashboard ? 'dashboard' : 'review', headerWorkspace.id)
      }} />
    {storageError && <p className="notice storage-notice" role="status">{storageError}</p>}
    {view === 'home' && <Landing onSample={chooseSample} />}
    {view === 'loading' && <main id="main" className="flow-wrap"><div className="flow-heading">
      <h1 tabIndex={-1}>Opening workspace</h1><p role="status">Restoring your spreadsheet and analysis…</p>
    </div></main>}
    {(view === 'import' || view === 'recover') && <ImportPage recovering={view === 'recover'} onFile={readFile} onSample={chooseSample}
      library={workspaces.length > 0 && <WorkspaceList workspaces={workspaces} onOpen={openWorkspace} onRemove={workspaceId => {
        const removed = workspaces.find(workspace => workspace.id === workspaceId)
        if (documentData?.id === workspaceId || documentData?.fingerprint && documentData.fingerprint === removed?.fingerprint) {
          saved.current = undefined
          setDocumentData(undefined)
        }
        remove(workspaceId)
      }} />} {...message} />}
      {view === 'review' && review && <ReviewPage source={review.source} dataset={review.dataset} edits={review.edits} settings={review.settings}
        editing={edit === 'open'} title={review.title} onBack={() => closeEditor()}
        onChangeFile={() => edit === 'open' ? navigate('import', undefined, true) : closeEditor()}
        onUpdate={updateSchema} onContinue={buildDashboard}
        onDelimiter={delimiter => { if (review.file) readFile(review.file, undefined, delimiter) }}
        onSheet={sheet => { if (review.file) readFile(review.file, sheet) }} {...message} />}
      {view === 'dashboard' && documentData && <Dashboard key={documentData.id} source={documentData.source}
        dataset={documentData.dataset} sample={Boolean(documentData.sample)} title={documentData.title} analysis={documentData.analysis}
        tablePosition={documentData.tablePosition} onReview={() => navigate('review', documentData.id, edit === 'closed', 'open')}
        importStatus={openedImport?.id === documentData.id ? openedImport.reopened ? 'reopened' : openedImport.automatic ? 'automatic' : 'reviewed' : undefined}
        hasDraft={Boolean(documentData.draft)} onPositionChange={() => setDocumentData(current => current && { ...current })}
        onAnalysis={patch => setDocumentData(current => current && { ...current, analysis: { ...current.analysis, ...patch } })} />}
  </>
}
