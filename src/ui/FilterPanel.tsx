import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ListFilter, Plus, X } from 'lucide-react'
import { filterDescription, initialDraft, operatorsFor, parseFilter } from '../data/filters'
import type { Filter, FilterDraft, MatchMode, Operator } from '../data/filters'
import { isMeasure } from '../data/model'
import type { Dataset } from '../data/model'
import { Field, Select } from './shared'

export function FilterButton({ open, count, controls, onClick }: {
  open: boolean; count: number; controls: string; onClick: () => void
}) {
  return <button type="button" className="button secondary filters-toggle" aria-expanded={open} aria-controls={controls} onClick={onClick}>
    <ListFilter size={16} /> Filters {count > 0 && <span className="filter-count">{count}</span>}
  </button>
}

export function FilterPanel({ dataset, filters, mode, onChange, onMode, open, onOpen, id }: {
  dataset: Dataset; filters: Filter[]; mode: MatchMode; onChange: (filters: Filter[]) => void; onMode: (mode: MatchMode) => void;
  open: boolean; onOpen: (open: boolean) => void; id: string
}) {
  const first = dataset.columns.find(column => column.kind === 'category') ?? dataset.columns[0]
  const [draft, setDraft] = useState<FilterDraft>(() => initialDraft(first))
  const [editing, setEditing] = useState<number>()
  const [error, setError] = useState('')
  const columnInput = useRef<HTMLSelectElement>(null)
  const hint = useId()
  const errorId = useId()
  const column = dataset.columns[draft.column]
  const dated = column.kind === 'date'
  const numeric = isMeasure(column.kind)
  const bounds = draft.operator === 'between'
  const hasInput = draft.operator !== 'missing' && draft.operator !== 'present'
  const choices = useMemo(() => {
    if (column.kind !== 'category') return undefined
    const options = new Set<string>()
    for (const row of dataset.rows) {
      if (row[column.index] !== null) options.add(String(row[column.index]))
      if (options.size > 100) return undefined
    }
    return [...options].sort((a, b) => a.localeCompare(b))
  }, [dataset.rows, column])

  useEffect(() => {
    if (open && editing !== undefined) columnInput.current?.focus()
  }, [open, editing])

  function update(next: FilterDraft) {
    setError('')
    setDraft(next)
  }

  function edit(filter: Filter, index: number) {
    setEditing(index)
    update({ column: filter.column, operator: filter.operator, value: String(filter.value ?? ''), end: String(filter.end ?? '') })
    if (open) columnInput.current?.focus()
    else onOpen(true)
  }

  function reset(next = initialDraft(column)) {
    setEditing(undefined)
    update(next)
  }

  function remove(index: number) {
    onChange(filters.filter((_, i) => index !== i))
    if (editing === index) reset()
    else if (editing !== undefined && index < editing) setEditing(editing - 1)
    if (open) columnInput.current?.focus()
    else document.querySelector<HTMLButtonElement>(`[aria-controls="${id}"]`)?.focus()
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const filter = parseFilter(draft, column)
      onChange(editing === undefined ? [...filters, filter] : filters.map((previous, index) => editing === index ? filter : previous))
      reset({ ...draft, value: '', end: '' })
      columnInput.current?.focus()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Check this condition and try again.')
    }
  }

  return <div id={id} className={`filters-area${open || filters.length ? ' has-content' : ''}`}>
    {filters.length > 0 && <div className="filter-chips" aria-label="Applied filters">
      <span className="filter-mode-label">{mode === 'all' ? 'Match all' : 'Match any'}</span>
      {filters.map((filter, i) => {
        const field = dataset.columns[filter.column]
        const description = filterDescription(filter, field)
        return <span className="filter-chip" key={i}>
          <button type="button" onClick={() => edit(filter, i)} aria-label={`Edit filter ${field.name} ${description}`}>
            <strong>{field.name}</strong> {description}
          </button>
          <button type="button" className="filter-remove" onClick={() => remove(i)} aria-label={`Remove filter ${field.name} ${description}`}><X size={14} /></button>
        </span>
      })}
      <button className="quiet-link" type="button" onClick={() => {
        onChange([]); reset(initialDraft(first)); onMode('all')
        if (open) columnInput.current?.focus()
        else document.querySelector<HTMLButtonElement>(`[aria-controls="${id}"]`)?.focus()
      }}>Clear filters</button>
    </div>}
    {open && <form className="panel filter-editor" onSubmit={apply} noValidate>
      <div className="filter-editor-heading">
        <div><h2>{editing === undefined ? 'Add a condition' : 'Edit condition'}</h2>
          <p id={hint}>Conditions apply to the entire dashboard.</p></div>
        <Field label="Combine conditions">
          <Select value={mode} onChange={event => onMode(event.target.value as MatchMode)}>
            <option value="all">Match all (AND)</option><option value="any">Match any (OR)</option>
          </Select>
        </Field>
      </div>
      <div className="filter-fields" aria-describedby={hint}>
        <Field label="Filter column"><Select ref={columnInput} value={draft.column} onChange={event => update(initialDraft(dataset.columns[Number(event.target.value)]))}>
          {dataset.columns.map(item => <option key={item.index} value={item.index}>{item.name}</option>)}
        </Select></Field>
        <Field label="Operator"><Select value={draft.operator} onChange={event => update({ ...draft, operator: event.target.value as Operator, end: '' })}>
          {operatorsFor(column.kind).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </Select></Field>
        {hasInput && <Field label={bounds ? (dated ? 'From date' : 'Minimum') : dated ? 'Date' : 'Value'}>
          {choices ? <Select value={draft.value} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
            onChange={event => update({ ...draft, value: event.target.value })}>
            <option value="">Choose a value</option>{choices.map(option => <option key={option} value={option}>{option}</option>)}
          </Select> : <input type={dated ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} value={draft.value}
            placeholder={numeric ? column.kind === 'percent' ? 'e.g. 25 for 25%' : 'e.g. 1200.50' : undefined}
            aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={event => update({ ...draft, value: event.target.value })} />}
        </Field>}
        {bounds && <Field label={dated ? 'To date' : 'Maximum'}>
          <input type={dated ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} value={draft.end}
            aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={event => update({ ...draft, end: event.target.value })} />
        </Field>}
      </div>
      <div className="filter-editor-footer">
        {error && <p className="field-error" id={errorId} role="alert">{error}</p>}
        <div>
          {editing !== undefined && <button className="button text-button" type="button" onClick={() => { reset(); columnInput.current?.focus() }}>Cancel edit</button>}
          <button className="button primary" type="submit">{editing === undefined && <Plus size={15} />}
            {editing === undefined ? 'Apply filter' : 'Save filter'}</button>
        </div>
      </div>
    </form>}
  </div>
}
