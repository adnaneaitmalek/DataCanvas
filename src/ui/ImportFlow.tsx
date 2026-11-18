import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, FileSpreadsheet, Info, LoaderCircle, LockKeyhole, UploadCloud } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { headerUnit } from '../data/currency'
import { currencies, defaultSettings, delimiterLabels, formatValue, integer, kinds, sourceValue } from '../data/model'
import type { Column, Dataset, Delimiter, Edits, Kind, Settings, Source } from '../data/model'
import type { SampleId } from '../data/samples'
import { Field, FileIdentity, SampleGrid, Select } from './shared'

export function Steps({ step }: { step: 1 | 2 }) {
  return <ol className="steps" aria-label="Import progress">
    {['Import file', 'Review columns', 'Dashboard'].map((label, i) =>
      <li key={label} aria-current={step === i + 1 ? 'step' : undefined} className={step > i + 1 ? 'step-done' : ''}>
        <span>{step > i + 1 ? <Check size={13} /> : i + 1}</span>{label}
      </li>)}
  </ol>
}

function ImportMessage({ busy, error, onCancel }: { busy: string; error: string; onCancel: () => void }) {
  return <>
    {error && <p className="notice error" role="alert"><Info size={17} />{error}</p>}
    {busy && <div className="notice busy" role="status">
      <LoaderCircle size={17} className="spin" /><span>{busy}…</span>
      <button className="quiet-link" type="button" onClick={onCancel}>Cancel</button>
    </div>}
  </>
}

export function ImportPage({ onFile, onSample, busy, error, onCancel, recovering, replaced }: {
  onFile: (file: File) => void; onSample: (sample: SampleId) => void; busy: string; error: string; onCancel: () => void
  recovering: boolean; replaced: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file && !busy) onFile(file)
  }
  return <main id="main" className="flow-wrap">
    <Steps step={1} />
    <div className="flow-heading">
      <h1 tabIndex={-1}>Import a spreadsheet</h1>
      <p>Choose a file to review its columns and build your dashboard.</p>
    </div>
    {(recovering || replaced) && <div className="notice scope-notice" role="status"><Info size={18} />
      <div>{replaced ? <><strong>This workspace was replaced.</strong><p>Reopen the spreadsheet or choose its sample to start a new session. Use Current dashboard to return to the active analysis when available.</p></>
        : <><strong>Reopen your analysis</strong><p>Analysis lives in this tab’s memory and clears when the page reloads. Reopen your spreadsheet to start a new session.</p></>}</div>
      <button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => input.current?.click()}>Reopen spreadsheet</button>
    </div>}
    <div className="import-layout">
      <section className="panel upload-panel" aria-labelledby="upload-title">
        <div className={`drop-zone${dragging ? ' is-dragging' : ''}`}
          onDragEnter={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true) } }}
          onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy' }}
          onDrop={drop} aria-busy={Boolean(busy)}>
          <span className="upload-icon"><UploadCloud size={27} aria-hidden="true" /></span>
          <h2 id="upload-title"><span className="upload-desktop-label">Drop your spreadsheet here</span><span className="upload-touch-label">Choose a spreadsheet</span></h2>
          <p>CSV, TSV, or Excel (.xlsx) up to 15 MB</p>
          <button className="button primary" type="button" disabled={Boolean(busy)} onClick={() => input.current?.click()}>Browse files <ArrowRight size={16} /></button>
          <input ref={input} type="file" accept=".csv,.tsv,.xlsx" aria-label="Spreadsheet file" hidden onChange={event => {
            const file = event.currentTarget.files?.[0]
            if (file) onFile(file)
            event.currentTarget.value = ''
          }} />
        </div>
        <ImportMessage busy={busy} error={error} onCancel={onCancel} />
        <div className="upload-footer"><LockKeyhole size={15} /> Your spreadsheet stays in this browser.</div>
      </section>
      <section className="import-samples" aria-labelledby="sample-title">
        <div className="section-heading"><h2 id="sample-title">Explore with sample data</h2><p>Pick a dataset to open its dashboard.</p></div>
        <SampleGrid onSample={onSample} />
      </section>
      <aside className="panel import-tips">
        <span className="sample-icon"><FileSpreadsheet size={21} /></span>
        <h2>Before you import</h2>
        <ul><li>Put column names in the first row.</li><li>Use one record per row.</li><li>For Excel workbooks, choose the worksheet you want to analyze.</li></ul>
      </aside>
    </div>
  </main>
}

const needsReview = (column: Column) => Boolean(column.invalid || column.missing || column.note)

function PreviewValue({ value }: { value: string }) {
  if (value.length <= 72) return <span title={value}>{value}</span>
  return <details className="example-disclosure">
    <summary title="Show full value">{value.slice(0, 55)}… <ChevronDown size={12} /></summary>
    <p>{value}</p>
  </details>
}

export function ReviewPage({ source, dataset, edits, settings, onUpdate, onSheet, onDelimiter, onContinue, busy, error, onCancel }: {
  source: Source; dataset: Dataset; edits: Edits; settings: Settings;
  onUpdate: (edits: Edits, settings: Settings) => void; onSheet: (sheet: string) => void;
  onDelimiter: (delimiter: Delimiter) => void
  onContinue: () => void; busy: string; error: string; onCancel: () => void
}) {
  const onEdit = (value: Edits) => onUpdate(value, settings)
  const onSettings = (value: Settings) => onUpdate(edits, value)
  const invalid = dataset.columns.reduce((sum, column) => sum + column.invalid, 0)
  const changed = Object.keys(edits).length > 0 || settings.numberStyle !== 'auto' || settings.dateOrder !== 'auto'
  const dialect = source.dialect
  const unresolved = Boolean(dialect?.ambiguous.length)
  const schemaId = useId()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const compact = dataset.columns.length > 12
  const issues = dataset.columns.filter(needsReview)

  function jump(column: Column) {
    setExpanded(previous => ({ ...previous, [column.name]: true }))
    requestAnimationFrame(() => {
      const row = document.getElementById(`${schemaId}-${column.index}`)
      row?.scrollIntoView({ block: 'start' })
      row?.focus({ preventScroll: true })
    })
  }

  return <main id="main" className="flow-wrap review-wrap">
    <Steps step={2} />
    <div className="flow-heading">
      <h1 tabIndex={-1}>Review your columns</h1>
      <p>Check the inferred types. Build dashboard applies the reviewed columns.</p>
    </div>
    <div className="panel review-file">
      <FileIdentity name={source.filename} detail={`${integer.format(source.rows.length)} rows · ${source.headers.length} columns`} />
      {source.sheets && source.sheets.length > 1 && <Field label="Worksheet">
        <Select value={source.sheet} disabled={Boolean(busy)} onChange={event => onSheet(event.target.value)}>
          {source.sheets.map(sheet => <option key={sheet}>{sheet}</option>)}
        </Select>
      </Field>}
      {dialect && <Field label="Delimiter">
        <Select value={unresolved ? '' : dialect.delimiter} disabled={Boolean(busy)} onChange={event => onDelimiter(event.target.value as Delimiter)}>
          {unresolved && <option value="" disabled>Choose a delimiter</option>}
          {Object.entries(delimiterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </Field>}
      <a className="button secondary" href="#/import">Change file</a>
    </div>
    <ImportMessage busy={busy} error={error} onCancel={onCancel} />
    {unresolved && dialect && <p className="notice" role="alert"><Info size={18} />
      <span>{new Intl.ListFormat('en').format(dialect.ambiguous.map(value => delimiterLabels[value]))} are plausible delimiters. The preview uses {delimiterLabels[dialect.delimiter].toLowerCase()}. Choose a delimiter and check the interpreted values before continuing.</span>
    </p>}
    {(source.notices.length > 0 || issues.length > 0) && <div className="notice review-issues"><Info size={18} />
      <div role="status">{source.notices.map(notice => <p key={notice}>{notice}</p>)}
        {issues.length > 0 && <p><strong>{integer.format(issues.length)} {issues.length === 1 ? 'column to review' : 'columns to review'}</strong></p>}
        {invalid > 0 && <p>{integer.format(invalid)} invalid {invalid === 1 ? 'value is' : 'values are'} treated as missing in charts.</p>}
      </div>
      {issues.length === 1 && <button className="button secondary" type="button" onClick={() => jump(issues[0])}><ArrowDown size={14} /> Review {issues[0].name}</button>}
      {issues.length > 1 && <Field label="Jump to a column to review"><Select value="" onChange={event => jump(dataset.columns[Number(event.target.value)])}>
        <option value="" disabled>Choose a column</option>
        {issues.map(column => <option key={column.index} value={column.index}>{column.name}</option>)}
      </Select></Field>}
    </div>}
    <div className="panel review-schema" aria-busy={Boolean(busy)}>
      <div className="panel-heading review-controls">
        <div><h2>Column settings</h2><p>Compare source values with how the dashboard will read them.</p></div>
        <div className="settings-fields">
          <Field label="Number format"><Select disabled={Boolean(busy)} value={settings.numberStyle} onChange={event => onSettings({ ...settings, numberStyle: event.target.value as Settings['numberStyle'] })}>
            <option value="auto">Auto detect</option><option value="dot">1,234.56</option><option value="comma">1.234,56</option>
          </Select></Field>
          <Field label="Date format"><Select disabled={Boolean(busy)} value={settings.dateOrder} onChange={event => onSettings({ ...settings, dateOrder: event.target.value as Settings['dateOrder'] })}>
            <option value="auto">Auto detect</option><option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option>
          </Select></Field>
        </div>
      </div>
      <ul className="schema-list" aria-label="Column preview">{dataset.columns.map(column => {
        const { index, kind, name } = column
        const edited = edits[index]
        const open = expanded[name] ?? (!compact || needsReview(column))
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
            {!column.invalid && !column.missing && !unresolved && <span className="quality-good"><Check size={14} /> Complete</span>}
            {compact && <button type="button" className="schema-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} column ${name}`}
              onClick={() => setExpanded(previous => ({ ...previous, [name]: !open }))}>
              {open ? 'Collapse' : [kinds[kind], column.unit, column.percentScale].filter(Boolean).join(' · ')} <ChevronDown size={15} />
            </button>}
          </div></div>
          {open && <><div className="schema-settings">
            <div className="type-controls">
              <Field label="Type"><Select disabled={Boolean(busy)} aria-label={`Type for ${name}`} value={kind} onChange={event => onEdit({
                ...edits, [index]: { kind: event.target.value as Kind, unit: column.unit ?? (headerUnit(name) !== '¥' ? headerUnit(name) : undefined) },
              })}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
              {kind === 'currency' && <Field label="Currency"><Select disabled={Boolean(busy)} aria-label={`Currency for ${name}`} value={column.unit} onChange={event => onEdit({
                ...edits, [index]: { kind: 'currency', unit: event.target.value },
              })}>{currencies.map(unit => <option key={unit} value={unit}>{unit === '$' ? '$ (unspecified)' : unit}</option>)}</Select></Field>}
              {kind === 'percent' && <Field label="Scale"><Select disabled={Boolean(busy)} aria-label={`Percentage scale for ${name}`} value={column.percentScale ?? 'points'} onChange={event => onEdit({
                ...edits, [index]: { kind: 'percent', percentScale: event.target.value as 'points' | 'fraction' },
              })}><option value="points">Points</option><option value="fraction">Fraction</option></Select></Field>}
            </div>
            {column.note && <p className="quality-note">{column.note}</p>}
            {(column.excludedUnmarked || edited?.assignUnmarked) && <div className="currency-policy">
              {column.excludedUnmarked ? <p>{integer.format(column.excludedUnmarked)} unmarked {column.excludedUnmarked === 1 ? 'amount is' : 'amounts are'} excluded{declared ? ` because the source column declares ${declared}` : ' because the source uses multiple currencies'}.</p> : null}
              <label className="checkbox"><input type="checkbox" disabled={Boolean(busy)} checked={Boolean(edited?.assignUnmarked)}
                onChange={event => onEdit({ ...edits, [index]: { kind: 'currency', unit: column.unit, assignUnmarked: event.target.checked } })} />
                Treat unmarked amounts as {column.unit}</label>
            </div>}
          </div>
          <div className="schema-examples" aria-label={`Examples for ${name}`}>
            <span className="example-heading">Source values</span><span className="example-heading">Interpreted values</span>
            {examples.size ? [...examples].map(([original, interpreted]) => <div className="example-pair" key={original}>
              <PreviewValue value={original} /><PreviewValue value={interpreted} />
            </div>) : <div className="example-pair"><span>—</span><span>—</span></div>}
          </div></>}
        </li>
      })}</ul>
      {dataset.columns.some(column => column.kind === 'percent') && <p className="panel-note">Use Points when a plain 12 means 12%. Use Fraction when 0.12 means 12%. Values with a % sign keep their original scale.</p>}
    </div>
    <div className="review-footer">
      <a className="button secondary" href="#/import"><ArrowLeft size={16} /> Back</a>
      <div>{changed && <button className="button text-button" type="button" disabled={Boolean(busy)} onClick={() => onUpdate({}, defaultSettings)}>Reset types</button>}
        <button className="button primary" type="button" disabled={Boolean(busy) || unresolved} onClick={onContinue}>Build dashboard <ArrowRight size={16} /></button>
      </div>
    </div>
  </main>
}
