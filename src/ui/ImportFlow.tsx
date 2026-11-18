import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, Info, LoaderCircle, LockKeyhole, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { currencies, defaultSettings, integer, kinds, sourceValue } from '../data/model'
import type { Dataset, Edits, Kind, Settings, Source } from '../data/model'
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

export function ImportPage({ onFile, onSample, busy, error, onCancel }: {
  onFile: (file: File) => void; onSample: (sample: SampleId) => void; busy: string; error: string; onCancel: () => void
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
    <div className="import-layout">
      <section className="panel upload-panel" aria-labelledby="upload-title">
        <div className={`drop-zone${dragging ? ' is-dragging' : ''}`}
          onDragEnter={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true) } }}
          onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy' }}
          onDrop={drop} aria-busy={Boolean(busy)}>
          <span className="upload-icon"><UploadCloud size={27} aria-hidden="true" /></span>
          <h2 id="upload-title">Drop your spreadsheet here</h2>
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
      <aside className="panel import-tips">
        <span className="sample-icon"><FileSpreadsheet size={21} /></span>
        <h2>Before you import</h2>
        <ul><li>Put column names in the first row.</li><li>Use one record per row.</li><li>For Excel workbooks, choose the worksheet you want to analyze.</li></ul>
      </aside>
    </div>
    <section className="import-samples" aria-labelledby="sample-title">
      <div className="section-heading"><h2 id="sample-title">Explore with sample data</h2><p>Pick a dataset to open its dashboard.</p></div>
      <SampleGrid onSample={onSample} />
    </section>
  </main>
}

export function ReviewPage({ source, dataset, edits, settings, onUpdate, onSheet, onContinue, busy, error, onCancel }: {
  source: Source; dataset: Dataset; edits: Edits; settings: Settings;
  onUpdate: (edits: Edits, settings: Settings) => void; onSheet: (sheet: string) => void;
  onContinue: () => void; busy: string; error: string; onCancel: () => void
}) {
  const onEdit = (value: Edits) => onUpdate(value, settings)
  const onSettings = (value: Settings) => onUpdate(edits, value)
  const invalid = dataset.columns.reduce((sum, column) => sum + column.invalid, 0)
  const changed = Object.keys(edits).length > 0 || settings.numberStyle !== 'auto' || settings.dateOrder !== 'auto'
  return <main id="main" className="flow-wrap review-wrap">
    <Steps step={2} />
    <div className="flow-heading">
      <h1 tabIndex={-1}>Review your columns</h1>
      <p>Check the inferred types before using your data in charts and filters.</p>
    </div>
    <div className="panel review-file">
      <FileIdentity name={source.filename} detail={`${integer.format(source.rows.length)} rows · ${source.headers.length} columns`} />
      {source.sheets && source.sheets.length > 1 && <Field label="Worksheet">
        <Select value={source.sheet} disabled={Boolean(busy)} onChange={event => onSheet(event.target.value)}>
          {source.sheets.map(sheet => <option key={sheet}>{sheet}</option>)}
        </Select>
      </Field>}
      <a className="button secondary" href="#/import">Change file</a>
    </div>
    <ImportMessage busy={busy} error={error} onCancel={onCancel} />
    {(source.notices.length > 0 || invalid > 0) && <div className="notice" role="status"><Info size={18} />
      <div>{source.notices.map(notice => <p key={notice}>{notice}</p>)}
        {invalid > 0 && <p>{integer.format(invalid)} {invalid === 1 ? 'cell does' : 'cells do'} not match the selected types or formats. These values are treated as missing in charts. Check the examples below.</p>}
      </div>
    </div>}
    <div className="panel review-schema" aria-busy={Boolean(busy)}>
      <div className="panel-heading review-controls">
        <div><h2>Column settings</h2><p>Previewing up to four source values per column.</p></div>
        <div className="settings-fields">
          <Field label="Number format"><Select disabled={Boolean(busy)} value={settings.numberStyle} onChange={event => onSettings({ ...settings, numberStyle: event.target.value as Settings['numberStyle'] })}>
            <option value="auto">Auto detect</option><option value="dot">1,234.56</option><option value="comma">1.234,56</option>
          </Select></Field>
          <Field label="Date format"><Select disabled={Boolean(busy)} value={settings.dateOrder} onChange={event => onSettings({ ...settings, dateOrder: event.target.value as Settings['dateOrder'] })}>
            <option value="auto">Auto detect</option><option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option>
          </Select></Field>
        </div>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Column preview">
        <table className="data-table schema-table">
          <thead><tr><th scope="col">Column</th><th scope="col">Type</th><th scope="col">Source examples</th><th scope="col">Data quality</th></tr></thead>
          <tbody>{dataset.columns.map(column => {
            const examples = Array.from(new Set(source.rows.slice(0, 60).map(row => sourceValue(row[column.index])).filter(value => value !== null && value !== ''))).slice(0, 4)
            return <tr key={column.index}>
              <th scope="row">{column.name}</th>
              <td><div className="type-controls">
                <Select disabled={Boolean(busy)} aria-label={`Type for ${column.name}`} value={column.kind} onChange={event => onEdit({
                  ...edits, [column.index]: { kind: event.target.value as Kind, unit: column.unit },
                })}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
                {column.kind === 'currency' && <Select disabled={Boolean(busy)} aria-label={`Currency for ${column.name}`} value={column.unit} onChange={event => onEdit({
                  ...edits, [column.index]: { kind: 'currency', unit: event.target.value },
                })}>{currencies.map(unit => <option key={unit} value={unit}>{unit === '$' ? '$ (unspecified)' : unit}</option>)}</Select>}
                {column.kind === 'percent' && <Select disabled={Boolean(busy)} aria-label={`Percentage scale for ${column.name}`} value={edits[column.index]?.percentScale ?? 'points'} onChange={event => onEdit({
                  ...edits, [column.index]: { kind: 'percent', percentScale: event.target.value as 'points' | 'fraction' },
                })}><option value="points">Points</option><option value="fraction">Fraction</option></Select>}
              </div></td>
              <td className="schema-examples">{examples.length ? examples.map(value => String(value)).join(' · ') : '—'}</td>
              <td>{column.invalid ? <span className="quality-warning">{integer.format(column.invalid)} invalid</span> : null}
                {column.missing ? <span className="quality-missing">{integer.format(column.missing)} missing</span> : null}
                {column.note && <span className="quality-note">{column.note}</span>}
                {!column.invalid && !column.missing && !column.note && <span className="quality-good"><Check size={14} /> Complete</span>}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {dataset.columns.some(column => column.kind === 'percent') && <p className="panel-note">Use Points when a plain 12 means 12%. Use Fraction when 0.12 means 12%. Values with a % sign keep their original scale.</p>}
    </div>
    <div className="review-footer">
      <a className="button secondary" href="#/import"><ArrowLeft size={16} /> Back</a>
      <div>{changed && <button className="button text-button" type="button" disabled={Boolean(busy)} onClick={() => onUpdate({}, defaultSettings)}>Reset types</button>}
        <button className="button primary" type="button" disabled={Boolean(busy)} onClick={onContinue}>Build dashboard <ArrowRight size={16} /></button>
      </div>
    </div>
  </main>
}
