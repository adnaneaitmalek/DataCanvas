import { ArrowRight, FileSpreadsheet, FolderOpen, LockKeyhole, Trash2 } from 'lucide-react'
import type { WorkspaceSummary } from '../data/workspaceStore'
import { integer } from '../data/model'
import { Brand, closePopover, Popover } from './shared'

function workspaceDetail(workspace: WorkspaceSummary) {
  const status = !workspace.hasDashboard ? 'Review needed'
    : workspace.hasDraft ? 'Column edits saved' : `${integer.format(workspace.rows)} rows`
  return !workspace.sample && workspace.title !== workspace.filename.replace(/\.[^.]+$/, '') ? `${workspace.filename} · ${status}` : status
}

export function SiteHeader({ view, workspaces, activeId, workspace, onOpen, onLibrary, onResume }: {
  view: string; workspaces: WorkspaceSummary[]; activeId?: string;
  workspace?: Pick<WorkspaceSummary, 'id' | 'hasDashboard'>
  onOpen: (workspace: WorkspaceSummary) => void; onLibrary: () => void; onResume: () => void
}) {
  const working = view !== 'home' && Boolean(workspace)
  return <header className={`site-shell${view === 'dashboard' ? ' site-shell-wide' : ''}`}>
    <div className="site-shell-inner">
      <Brand />
      <nav aria-label="Main navigation">
        <a href="#/import" aria-current={view === 'import' ? 'page' : undefined} onClick={event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          onLibrary()
        }}>Import</a>
        {working ? <>
          <a className="shell-context" href={workspace?.hasDashboard ? '#/dashboard' : '#/review'}
            aria-current={view === 'dashboard' || view === 'review' && !workspace?.hasDashboard ? 'page' : undefined}
            onClick={event => {
              if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              onResume()
            }}>{workspace?.hasDashboard ? 'Dashboard' : 'Review import'}</a>
          {view === 'review' && workspace?.hasDashboard && <span className="shell-context shell-current" aria-current="page">Column settings</span>}
        </> : <>
          <a className="shell-samples" href="#sample-data">Sample data</a>
          <a className="shell-help" href="#how-it-works">How it works</a>
        </>}
      </nav>
      <div className="shell-workspaces">
        {workspaces.length > 0 ? <Popover className="workspace-menu" buttonClass="button secondary"
          label={<><FolderOpen size={15} aria-hidden="true" /> Your work</>}>
          <div className="panel workspace-choices">
            <p>Saved in this browser</p>
            {workspaces.map(workspace => <button type="button" key={workspace.id} aria-current={activeId === workspace.id ? 'true' : undefined}
              onClick={event => { closePopover(event.currentTarget.closest('details')); onOpen(workspace) }}>
              <span><strong>{workspace.title}</strong><small>{workspaceDetail(workspace)}</small></span><ArrowRight size={15} aria-hidden="true" />
            </button>)}
          </div>
        </Popover> : <span className="shell-local"><LockKeyhole size={14} aria-hidden="true" /> Local to this browser</span>}
      </div>
    </div>
  </header>
}

export function WorkspaceList({ workspaces, onOpen, onRemove }: {
  workspaces: WorkspaceSummary[]; onOpen: (workspace: WorkspaceSummary) => void; onRemove: (id: string) => void
}) {
  return <section className="panel recent-work" aria-labelledby="workspaces-title">
    <div className="recent-heading"><h2 id="workspaces-title">Your work</h2><p>Pick up where you left off.</p></div>
    <ul>{workspaces.map(workspace => <li key={workspace.id}>
      <button type="button" className="recent-open" onClick={() => onOpen(workspace)}>
        <FileSpreadsheet size={17} aria-hidden="true" />
        <span><strong title={workspace.title}>{workspace.title}</strong><small>{workspaceDetail(workspace)}</small></span>
        <ArrowRight size={15} aria-hidden="true" />
      </button>
      <button type="button" className="button text-button icon-button recent-remove" aria-label={`Remove ${workspace.title}`}
        onClick={() => {
          if (window.confirm(`Remove “${workspace.title}” and its saved analysis from this browser?`)) onRemove(workspace.id)
        }}><Trash2 size={15} aria-hidden="true" /></button>
    </li>)}</ul>
  </section>
}
