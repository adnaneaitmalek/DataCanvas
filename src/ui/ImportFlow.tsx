import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, Info, LoaderCircle, LockKeyhole, UploadCloud } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { headerUnit } from '../data/currency'
import { columnNeedsDecision, importReview, interpretationKey, needsColumnReview } from '../data/importReview'
import { currencies, defaultSettings, delimiterLabels, formatValue, integer, kinds, sourceValue } from '../data/model'
import type { Column, Dataset, Delimiter, Edits, Kind, Settings, Source } from '../data/model'
import type { SampleId } from '../data/samples'
import { Field, FileIdentity, SampleGrid, Select } from './shared'

function ImportMessage({ busy, error, onCancel }: { busy: string; error: string; onCancel: () => void }) {
  return <>
    {error && <p className="notice error" role="alert"><Info size={17} />{error}</p>}
    {busy && <div className="notice busy" role="status">
      <LoaderCircle size={17} className="spin" /><span>{busy}…</span>
      <button className="quiet-link" type="button" onClick={onCancel}>Cancel</button>
    </div>}
  </>
}

export function ImportPage({ onFile, onSample, busy, error, onCancel, recovering, library }: {
  onFile: (file: File) => void; onSample: (sample: SampleId) => void; busy: string; error: string; onCancel: () => void
  recovering: boolean; library?: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const choose = useRef<HTMLButtonElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [feedback, setFeedback] = useState('')
  function chooseFile(file: File) {
    setFeedback('')
    onFile(file)
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (busy) return
    if (event.dataTransfer.files.length > 1) {
      setFeedback('Choose one spreadsheet at a time.')
      return
    }
    const file = event.dataTransfer.files[0]
    if (file) chooseFile(file)
  }
  return <main id="main" className="flow-wrap">
    <div className="flow-heading">
      <h1 tabIndex={-1}>{recovering ? 'Reopen a workspace' : 'Import a spreadsheet'}</h1>
      {!recovering && <p>Choose a file to build a dashboard. We’ll ask if anything needs a closer look.</p>}
    </div>
    {recovering && <div className="notice recovery-notice" role="status"><Info size={18} />
      <div><strong>This workspace is unavailable.</strong><p>Open saved work from this browser or choose the original spreadsheet again.</p></div>
    </div>}
    <div className={`import-layout${library ? ' has-library' : ''}`}>
      <section className="panel upload-panel" aria-labelledby="upload-title">
        <div className={`drop-zone${dragging ? ' is-dragging' : ''}`}
          onDragEnter={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true) } }}
          onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy' }}
          onDrop={drop}>
          <span className="upload-icon"><UploadCloud size={27} aria-hidden="true" /></span>
          <h2 id="upload-title">{busy ? 'Preparing your dashboard' : 'Choose a spreadsheet'}</h2>
          {busy ? <ImportMessage busy={busy} error="" onCancel={() => {
            onCancel()
            setFeedback('Import cancelled. You can choose another file.')
            requestAnimationFrame(() => choose.current?.focus())
          }} /> : <>
            <p>CSV, TSV, or Excel (.xlsx) up to 15 MB</p>
            <button ref={choose} className="button primary" type="button" onClick={() => input.current?.click()}>
              {recovering ? 'Reopen spreadsheet' : 'Choose file'} <ArrowRight size={16} />
            </button>
            <span className="upload-desktop-label">or drag it here</span>
          </>}
          <input ref={input} type="file" accept=".csv,.tsv,.xlsx" aria-label="Spreadsheet file" hidden onChange={event => {
            const file = event.currentTarget.files?.[0]
            if (file) chooseFile(file)
            event.currentTarget.value = ''
          }} />
        </div>
        {error && <ImportMessage busy="" error={error} onCancel={onCancel} />}
        {feedback && <p className="upload-feedback" role="status">{feedback}</p>}
        <div className="upload-footer"><LockKeyhole size={15} /> Your file and analysis stay in this browser.</div>
        <details className="import-help">
          <summary>How should I format my file? <ChevronDown size={14} /></summary>
          <p>Use the first row for column names and one row per record. With multiple Excel sheets, you’ll choose which one to use.</p>
        </details>
      </section>
      {library}
      <section className="import-samples" aria-labelledby="sample-title">
        <div className="section-heading"><h2 id="sample-title">Explore with sample data</h2><p>Pick a dataset to open its dashboard.</p></div>
        <SampleGrid onSample={onSample} />
      </section>
    </div>
  </main>
}

function PreviewValue({ value }: { value: string }) {
  if (value.length <= 72) return <span title={value}>{value}</span>
  return <details className="example-disclosure">
    <summary title="Show full value">{value.slice(0, 55)}… <ChevronDown size={12} /></summary>
    <p>{value}</p>
  </details>
}

export function ReviewPage({ source, dataset, edits, settings, editing, title, onBack, onChangeFile, onUpdate, onSheet, onDelimiter, onContinue, busy, error, onCancel }: {
  source: Source; dataset: Dataset; edits: Edits; settings: Settings;
  editing: boolean; title: string; onBack: () => void; onChangeFile: () => void;
  onUpdate: (edits: Edits, settings: Settings) => void; onSheet: (sheet: string) => void;
  onDelimiter: (delimiter: Delimiter) => void
  onContinue: () => void; busy: string; error: string; onCancel: () => void
}) {
  const footer = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = footer.current
    if (!element) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--review-footer-clearance', `${Math.ceil(element.getBoundingClientRect().height) + 16}px`)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => { observer.disconnect(); root.style.removeProperty('--review-footer-clearance') }
  }, [])
  const [history, setHistory] = useState<{ source: Source; edits: Edits; settings: Settings }[]>([])
  const latestChange = history.at(-1)
  const undo = latestChange?.source === source ? latestChange : undefined
  function change(nextEdits: Edits, nextSettings: Settings) {
    // Column indexes can change when a worksheet or delimiter is reparsed.
    setHistory(previous => [...(previous.at(-1)?.source === source ? previous.slice(-19) : []), { source, edits, settings }])
    onUpdate(nextEdits, nextSettings)
  }
  const onEdit = (value: Edits) => change(value, settings)
  const onSettings = (value: Settings) => change(edits, value)
  const invalid = dataset.columns.reduce((sum, column) => sum + column.invalid, 0)
  const changed = Object.keys(edits).length > 0 || settings.numberStyle !== 'auto' || settings.dateOrder !== 'auto'
  const dialect = source.dialect
  const assessment = importReview(source, dataset)
  const { columns: issues, delimiter: unresolved } = assessment
  const schemaId = useId()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [initialIssues] = useState(() => new Set(issues.map(column => column.name)))
  const [initialDelimiterIssue] = useState(unresolved)
  const [showAll, setShowAll] = useState(false)
  const [fileOptions, setFileOptions] = useState(unresolved)
  const relevant = dataset.columns.filter(column => initialDelimiterIssue || needsColumnReview(column) || initialIssues.has(column.name))
  const visible = showAll ? dataset.columns : relevant
  const decisionCount = assessment.decisions.length + Number(unresolved)

  function jump(column: Column) {
    setExpanded(previous => ({ ...previous, [column.name]: true }))
    requestAnimationFrame(() => {
      const row = document.getElementById(`${schemaId}-${column.index}`)
      row?.scrollIntoView({ block: 'start' })
      row?.focus({ preventScroll: true })
    })
  }

  return <main id="main" className="flow-wrap review-wrap">
    <div className="flow-heading">
      <h1 tabIndex={-1}>{editing ? 'Edit columns' : 'Review your import'}</h1>
      {editing ? <p className="review-context">Changes to <strong>{title}</strong> stay in a draft until you apply them.</p>
        : <p>Resolve the choices below. All other columns are ready to use.</p>}
    </div>
    <div className="panel review-file">
      <FileIdentity name={source.filename} detail={`${integer.format(source.rows.length)} rows · ${source.headers.length} columns`} />
      {source.sheets && source.sheets.length > 1 && <Field label="Worksheet">
        <Select value={source.sheet} disabled={Boolean(busy)} onChange={event => onSheet(event.target.value)}>
          {source.sheets.map(sheet => <option key={sheet}>{sheet}</option>)}
        </Select>
      </Field>}
      {dialect && (fileOptions || unresolved) && <Field label="Delimiter">
        <Select value={unresolved ? '' : dialect.delimiter} disabled={Boolean(busy)} onChange={event => onDelimiter(event.target.value as Delimiter)}>
          {unresolved && <option value="" disabled>Choose a delimiter</option>}
          {Object.entries(delimiterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </Field>}
      <button className="button text-button" type="button" onClick={onChangeFile}>Change file</button>
      {dialect && !unresolved && <button className="quiet-link file-options-toggle" type="button" aria-expanded={fileOptions}
        onClick={() => setFileOptions(!fileOptions)}>File settings <ChevronDown size={14} /></button>}
    </div>
    <ImportMessage busy={busy} error={error} onCancel={onCancel} />
    <section className={`panel readiness${assessment.blocked ? ' needs-decisions' : ''}`} aria-labelledby="readiness-title">
      <div className="readiness-title" role="status"><span className="readiness-icon">{assessment.blocked ? <Info size={20} /> : <Check size={20} />}</span>
        <div><h2 id="readiness-title">{assessment.blocked ? `${decisionCount} ${decisionCount === 1 ? 'choice' : 'choices'} before your dashboard` : 'Ready for your dashboard'}</h2>
          <p>{assessment.blocked ? 'Choose an interpretation or explicitly exclude uncertain values.' : 'Your file can be analyzed with the settings below.'}</p>
        </div>
      </div>
      <div className="readiness-bottom"><div className="readiness-facts">
        <span>{dataset.columns.length - issues.length} columns ready</span>
        {issues.length > 0 && <span>{issues.length} to check</span>}
        {invalid > 0 && <span>{integer.format(invalid)} unreadable values</span>}
      </div>
      {issues.length === 1 && <button className="button secondary" type="button" onClick={() => jump(issues[0])}><ArrowDown size={14} /> Review {issues[0].name}</button>}
      {issues.length > 1 && <Field label="Jump to a column to review"><Select value="" onChange={event => jump(dataset.columns[Number(event.target.value)])}>
        <option value="" disabled>Choose a column</option>
        {issues.map(column => <option key={column.index} value={column.index}>{column.name}</option>)}
      </Select></Field>}
      </div>
      {!assessment.blocked && issues.length === 0 && !source.notices.length && <p className="readiness-optional">Column settings are optional. Expand a column to change its type or format.</p>}
    </section>
    {unresolved && dialect && <p className="notice" role="alert"><Info size={18} />
      <span>{new Intl.ListFormat('en').format(dialect.ambiguous.map(value => delimiterLabels[value]))} are plausible delimiters. The preview uses {delimiterLabels[dialect.delimiter].toLowerCase()}. Choose a delimiter and check the interpreted values before continuing.</span>
    </p>}
    {assessment.worksheet && !editing && <p className="review-guidance">Choose the worksheet you want to analyze. The row and column count above reflects the selected sheet.</p>}
    {source.notices.length > 0 && <div className="notice" role="status"><Info size={18} />
      <div>{source.notices.map(notice => <p key={notice}>{notice}</p>)}</div>
    </div>}
    <div className="panel review-schema" aria-busy={Boolean(busy)}>
      <div className="panel-heading review-controls">
        <div><h2>{showAll ? 'Column settings' : issues.length ? 'Columns to check' : 'Column types'}</h2><p>{visible.length ? 'Compare source values with how the dashboard will read them.' : 'The column types were detected.'}</p></div>
        {(relevant.length > 0 || showAll) && <div className="settings-fields">
          {(showAll || relevant.some(column => ['number', 'currency', 'percent'].includes(column.kind))) && <Field label="Number format"><Select disabled={Boolean(busy)} value={settings.numberStyle} onChange={event => onSettings({ ...settings, numberStyle: event.target.value as Settings['numberStyle'] })}>
            <option value="auto">Auto detect</option><option value="dot">1,234.56</option><option value="comma">1.234,56</option>
          </Select></Field>}
          {(showAll || relevant.some(column => column.kind === 'date')) && <Field label="Date format"><Select disabled={Boolean(busy)} value={settings.dateOrder} onChange={event => onSettings({ ...settings, dateOrder: event.target.value as Settings['dateOrder'] })}>
            <option value="auto">Auto detect</option><option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option>
          </Select></Field>}
        </div>}
      </div>
      {visible.length > 0 && <ul className="schema-list" aria-label="Column preview">{visible.map(column => {
        const { index, kind, name } = column
        const edited = edits[index]
        const open = expanded[name] ?? (initialDelimiterIssue || needsColumnReview(column) || initialIssues.has(name))
        const examples = new Map<string, string>()
        for (let row = 0; open && row < 80 && row < source.rows.length && examples.size < 4; row++) {
          const original = sourceValue(source.rows[row][index])
          if (original === null || original === '') continue
          const interpreted = dataset.rows[row][index]
          examples.set(String(original), interpreted === null ? '—' : formatValue(interpreted, column))
        }
        if (open && column.invalid && ![...examples.values()].includes('—')) {
          const row = source.rows.findIndex((record, at) => {
            if (dataset.rows[at][index] !== null) return false
            const value = sourceValue(record[index])
            return value !== null && !/^(?:\s*|n\/a|null|#n\/a|—)$/i.test(String(value))
          })
          if (row >= 0) examples.set(String(sourceValue(source.rows[row][index])), '—')
        }
        const declared = kind === 'currency' ? headerUnit(name) : undefined
        return <li className={`schema-row${open ? '' : ' schema-compact'}`} key={index} id={`${schemaId}-${index}`} tabIndex={-1}>
          <div className="schema-identity"><h3>{name}</h3><div className="schema-quality">
            {column.invalid > 0 && <span className="quality-warning">{integer.format(column.invalid)} invalid</span>}
            {column.missing > 0 && <span className="quality-missing">{integer.format(column.missing)} missing</span>}
            {!needsColumnReview(column) && !column.missing && !unresolved && <span className="quality-good"><Check size={14} /> Complete</span>}
            <button type="button" className="schema-toggle" aria-expanded={open} aria-controls={`${schemaId}-settings-${index}`} aria-label={`${open ? 'Collapse' : 'Expand'} column ${name}`}
              onClick={() => setExpanded(previous => ({ ...previous, [name]: !open }))}>
              {open ? 'Collapse' : [kinds[kind], column.unit, column.percentScale].filter(Boolean).join(' · ')} <ChevronDown size={15} />
            </button>
          </div></div>
          {open && <div className="schema-details" id={`${schemaId}-settings-${index}`}><div className="schema-settings">
            <div className="type-controls">
              <Field label="Type"><Select disabled={Boolean(busy)} aria-label={`Type for ${name}`} value={kind} onChange={event => onEdit({
                ...edits, [index]: { ...edited, kind: event.target.value as Kind, unit: column.unit ?? (headerUnit(name) !== '¥' ? headerUnit(name) : undefined) },
              })}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
              {kind === 'currency' && <Field label="Currency"><Select disabled={Boolean(busy)} aria-label={`Currency for ${name}`} value={column.unit} onChange={event => onEdit({
                ...edits, [index]: { kind: 'currency', unit: event.target.value },
              })}>{currencies.map(unit => <option key={unit} value={unit}>{unit === '$' ? '$ (unspecified)' : unit}</option>)}</Select></Field>}
              {kind === 'percent' && <Field label="Scale"><Select disabled={Boolean(busy)} aria-label={`Percentage scale for ${name}`} value={column.confirmPercentScale ? '' : column.percentScale ?? 'points'} onChange={event => onEdit({
                ...edits, [index]: { kind: 'percent', percentScale: event.target.value as 'points' | 'fraction' },
              })}>{column.confirmPercentScale && <option value="" disabled>Choose a scale</option>}<option value="points">Points</option><option value="fraction">Fraction</option></Select></Field>}
            </div>
            {column.note && <p className="quality-note">{column.note}</p>}
            {kind === 'date' && column.dateOrder === 'auto' && column.invalid > 0 && <p className="quality-note">Choose the date format above. Unreadable dates will be excluded from time charts.</p>}
            {['number', 'currency', 'percent'].includes(kind) && column.invalid > 0 && <p className="quality-note">Choose the number format above. Only readable values contribute to totals and averages.</p>}
            {(column.excludedUnmarked || edited?.assignUnmarked) && <div className="currency-policy">
              {column.excludedUnmarked ? <p>{integer.format(column.excludedUnmarked)} unmarked {column.excludedUnmarked === 1 ? 'amount is' : 'amounts are'} excluded{declared ? ` because the source column declares ${declared}` : ' because the source uses multiple currencies'}.</p> : null}
              <label className="checkbox"><input type="checkbox" disabled={Boolean(busy)} checked={Boolean(edited?.assignUnmarked)}
                onChange={event => onEdit({ ...edits, [index]: { kind: 'currency', unit: column.unit, assignUnmarked: event.target.checked } })} />
                Treat unmarked amounts as {column.unit}</label>
            </div>}
            {needsColumnReview(column) && !column.confirmPercentScale && !(kind === 'currency' && column.unit === '$') && <label className="checkbox interpretation-choice">
              <input type="checkbox" disabled={Boolean(busy)} checked={!columnNeedsDecision(column)} onChange={event => onEdit({
                ...edits, [index]: { ...edited, kind, unit: column.unit, percentScale: column.percentScale,
                  acceptedInterpretation: event.target.checked ? interpretationKey(column) : undefined },
              })} />
              <span>{column.invalid ? `Use ${integer.format(dataset.rows.length - column.missing - column.invalid)} readable values; exclude ${integer.format(column.invalid)} unreadable values`
                : ['text', 'category', 'identifier'].includes(kind) ? 'Keep as text; exclude this column from numeric calculations' : 'I checked the source values and accept this interpretation'}</span>
            </label>}
          </div>
          <div className="schema-examples" aria-label={`Examples for ${name}`}>
            <span className="example-heading">Source values</span><span className="example-heading">Interpreted values</span>
            {examples.size ? [...examples].map(([original, interpreted]) => <div className="example-pair" key={original}>
              <PreviewValue value={original} /><PreviewValue value={interpreted} />
            </div>) : <div className="example-pair"><span>—</span><span>—</span></div>}
          </div></div>}
        </li>
      })}</ul>}
      {visible.some(column => column.kind === 'percent') && <p className="panel-note">Use Points when a plain 12 means 12%. Use Fraction when 0.12 means 12%. Values with a % sign keep their original scale.</p>}
      {relevant.length < dataset.columns.length && <div className="review-disclosure">
        <button className="quiet-link" type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show only flagged columns' : `Show all ${dataset.columns.length} columns`} <ChevronDown size={14} />
        </button>
      </div>}
    </div>
    <div className="review-footer" ref={footer}>
      <button className="button secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> {editing ? 'Cancel' : 'Back to import'}</button>
      <div>{undo && <button className="button text-button" type="button" disabled={Boolean(busy)} onClick={() => {
        setHistory(history.slice(0, -1))
        onUpdate(undo.edits, undo.settings)
      }}>Undo change</button>}
        {changed && <button className="button text-button" type="button" disabled={Boolean(busy)} onClick={() => change({}, defaultSettings)}>Reset types</button>}
        <button className="button primary" type="button" disabled={Boolean(busy) || assessment.blocked}
          aria-describedby={assessment.blocked ? 'readiness-title' : undefined} onClick={onContinue}>
          {editing ? 'Apply changes' : 'Open dashboard'} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  </main>
}
