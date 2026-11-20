import type { AnalysisState, TablePosition } from './analysisState'
import type { Dataset, Edits, Settings, Source } from './model'
import type { SampleId } from './samples'
import { fileFingerprint } from './fileIdentity'

export type Spreadsheet = {
  source: Source; dataset: Dataset; title: string; sample?: SampleId; file?: File
  edits: Edits; settings: Settings
}

export type Workspace = Spreadsheet & {
  id: string; fingerprint?: string; contentRevision: string; analysis: AnalysisState; hasDashboard: boolean; tablePosition: TablePosition; draft?: Spreadsheet
}

export type WorkspaceSummary = {
  id: string; fingerprint?: string; title: string; filename: string; rows: number; sample?: SampleId
  hasDashboard: boolean; hasDraft: boolean; updated: number
}

type WorkspaceIndex = WorkspaceSummary & {
  contentRevision: string; analysis: AnalysisState; tablePosition: TablePosition; edits: Edits; settings: Settings
}

type WorkspaceContent = Pick<Workspace, 'id' | 'source' | 'dataset' | 'file' | 'draft'>

export function summarizeWorkspace(workspace: Workspace): WorkspaceSummary {
  return {
    id: workspace.id, fingerprint: workspace.fingerprint, title: workspace.title, filename: workspace.source.filename, rows: workspace.dataset.rows.length,
    sample: workspace.sample, hasDashboard: workspace.hasDashboard, hasDraft: Boolean(workspace.draft), updated: Date.now(),
  }
}

/** Keep history IDs readable, and prefer a completed analysis over an unfinished duplicate. */
export function visibleWorkspaces(workspaces: WorkspaceSummary[]) {
  const files = new Map<string, WorkspaceSummary>()
  for (const workspace of [...workspaces].sort((a, b) => b.updated - a.updated)) {
    const key = workspace.fingerprint ?? workspace.id
    const previous = files.get(key)
    if (!previous || !previous.hasDashboard && workspace.hasDashboard) files.set(key, workspace)
  }
  return [...files.values()].sort((a, b) => b.updated - a.updated)
}

let database: Promise<IDBDatabase> | undefined

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => reject(operation.error)
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
}

function openDatabase() {
  if (!database) {
    const opening = indexedDB.open('datacanvas-workspaces', 1)
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore('workspaces', { keyPath: 'id' })
      opening.result.createObjectStore('content', { keyPath: 'id' })
    }
    database = request(opening).then(db => {
      db.onversionchange = () => { db.close(); database = undefined }
      return db
    }).catch(error => {
      database = undefined
      throw error
    })
  }
  return database
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const db = await openDatabase()
  const records: WorkspaceIndex[] = await request(db.transaction('workspaces').objectStore('workspaces').getAll())
  // Backfill older uploads once, without changing their analysis, history IDs, or recency.
  for (const record of records) {
    if (record.fingerprint || record.sample) continue
    const content: WorkspaceContent | undefined = await request(db.transaction('content').objectStore('content').get(record.id))
    if (content?.file) await rememberFingerprint(record.id, await fileFingerprint(content.file))
  }
  const latest: WorkspaceIndex[] = await request(db.transaction('workspaces').objectStore('workspaces').getAll())
  return visibleWorkspaces(latest.map(({ id, fingerprint, title, filename, rows, sample, hasDashboard, hasDraft, updated }) =>
    ({ id, fingerprint, title, filename, rows, sample, hasDashboard, hasDraft, updated })))
}

async function rememberFingerprint(id: string, fingerprint: string) {
  const db = await openDatabase()
  const transaction = db.transaction('workspaces', 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore('workspaces')
  const latest: WorkspaceIndex | undefined = await request(store.get(id))
  if (latest && !latest.fingerprint) store.put({ ...latest, fingerprint })
  await done
}

export async function readWorkspace(id: string): Promise<Workspace | undefined> {
  const db = await openDatabase()
  const transaction = db.transaction(['workspaces', 'content'])
  const [index, content]: [WorkspaceIndex | undefined, WorkspaceContent | undefined] = await Promise.all([
    request(transaction.objectStore('workspaces').get(id)),
    request(transaction.objectStore('content').get(id)),
  ])
  const fingerprint = index?.fingerprint ?? (content?.file ? await fileFingerprint(content.file) : undefined)
  if (index && fingerprint && !index.fingerprint) await rememberFingerprint(id, fingerprint)
  return index && content ? {
    ...content, title: index.title, sample: index.sample, hasDashboard: index.hasDashboard, analysis: index.analysis,
    fingerprint, contentRevision: index.contentRevision ?? index.id,
    tablePosition: index.tablePosition, edits: index.edits, settings: index.settings,
  } : undefined
}

export async function writeWorkspace(workspace: Workspace, summary: WorkspaceSummary, includeContent: boolean) {
  const db = await openDatabase()
  const transaction = db.transaction(includeContent ? ['workspaces', 'content'] : 'workspaces', 'readwrite')
  const done = transactionDone(transaction)
  const { analysis, tablePosition, edits, settings, id, contentRevision, source, dataset, file, draft } = workspace
  const index = transaction.objectStore('workspaces')
  const previous: WorkspaceIndex | undefined = await request(index.get(id))
  if (!includeContent) {
    // An older tab must never attach its filters to a different schema.
    if (!previous || (previous.contentRevision ?? previous.id) !== contentRevision) {
      await done
      throw new Error('The saved worksheet changed.')
    }
  }
  if (includeContent) transaction.objectStore('content').put({ id, source, dataset, file, draft } satisfies WorkspaceContent)
  index.put({ ...summary, fingerprint: summary.fingerprint ?? previous?.fingerprint, contentRevision, analysis, tablePosition, edits, settings } satisfies WorkspaceIndex)
  await done
}

export async function deleteWorkspace(id: string) {
  const db = await openDatabase()
  const transaction = db.transaction(['workspaces', 'content'], 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore('workspaces')
  const records: WorkspaceIndex[] = await request(store.getAll())
  const fingerprint = records.find(record => record.id === id)?.fingerprint
  const removed = records.filter(record => record.id === id || fingerprint && record.fingerprint === fingerprint)
  for (const record of removed) {
    store.delete(record.id)
    transaction.objectStore('content').delete(record.id)
  }
  await done
  return removed.map(record => record.id)
}
