import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { BUCKETS, SOURCES, type Bucket, type LedgerSettings, type Sale, type Source, type Spending, type StockItem } from './types'

type Section = 'Ledger' | 'Inventory' | 'P&L'
type Period = 'All time' | 'This month' | 'This year'
type EditTarget =
  | { kind: 'sale'; record: Sale }
  | { kind: 'spending'; record: Spending }
  | { kind: 'stock'; record: StockItem }

const today = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
const money = (value: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(value).replace(/\u00a0/g, ' ')
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
const sum = (items: { amount: number }[]) => items.reduce((total, item) => total + Number(item.amount), 0)

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [section, setSection] = useState<Section>('Ledger')
  const [sales, setSales] = useState<Sale[]>([])
  const [spending, setSpending] = useState<Spending[]>([])
  const [stock, setStock] = useState<StockItem[]>([])
  const [settings, setSettings] = useState<LedgerSettings>({
    user_id: '',
    savings_goal: 0,
    savings_percent: 20,
    expenses_percent: 50,
    restocking_percent: 30,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<Period>('All time')

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }
    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (authError) setError(authError.message)
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  const refresh = useCallback(async () => {
    if (!supabase || !session?.user.id) return
    setLoading(true)
    setError('')
    const [salesResult, spendingResult, stockResult, settingsResult] = await Promise.all([
      supabase.from('sales').select('*').order('sold_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('spending').select('*').order('spent_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('inventory').select('*').order('added_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('ledger_settings').select('*').maybeSingle(),
    ])
    const failure = salesResult.error || spendingResult.error || stockResult.error || settingsResult.error
    if (failure) {
      setError(`Could not load your ledger: ${failure.message}`)
    } else {
      setSales(salesResult.data as Sale[])
      setSpending(spendingResult.data as Spending[])
      setStock(stockResult.data as StockItem[])
      const savedSettings = settingsResult.data as LedgerSettings | null
      setSettings(savedSettings ? {
        ...savedSettings,
        savings_goal: Number(savedSettings.savings_goal),
        savings_percent: Number(savedSettings.savings_percent),
        expenses_percent: Number(savedSettings.expenses_percent),
        restocking_percent: Number(savedSettings.restocking_percent),
      } : {
        user_id: session.user.id,
        savings_goal: 0,
        savings_percent: 20,
        expenses_percent: 50,
        restocking_percent: 30,
      })
    }
    setLoading(false)
  }, [session?.user.id])

  useEffect(() => {
    if (session) void refresh()
    else {
      setSales([])
      setSpending([])
      setStock([])
    }
  }, [session, refresh])

  async function saveSettings(next: Partial<LedgerSettings>) {
    if (!supabase || !session) return
    const updated = { ...settings, ...next, user_id: session.user.id }
    const { error: saveError } = await supabase.from('ledger_settings').upsert(updated, { onConflict: 'user_id' })
    if (saveError) throw saveError
    setSettings(updated)
    setNotice('Your settings have been saved.')
  }

  async function saveEdit(target: EditTarget, values: Record<string, string | number>) {
    if (!supabase) return
    const table = target.kind === 'sale' ? 'sales' : target.kind === 'spending' ? 'spending' : 'inventory'
    const { error: saveError } = await supabase.from(table).update(values).eq('id', target.record.id)
    if (saveError) throw saveError
    setEditing(null)
    setNotice('Your changes have been saved.')
    await refresh()
  }

  async function deleteRecord(kind: EditTarget['kind'], id: string) {
    if (!supabase || !window.confirm('Delete this entry? This cannot be undone.')) return
    const table = kind === 'sale' ? 'sales' : kind === 'spending' ? 'spending' : 'inventory'
    const { error: deleteError } = await supabase.from(table).delete().eq('id', id)
    if (deleteError) setError(`Could not delete entry: ${deleteError.message}`)
    else {
      setNotice('Entry deleted.')
      await refresh()
    }
  }

  async function resetData() {
    if (!supabase || !window.confirm('Reset all ledger data, stock and settings? This cannot be undone.')) return
    const { error: resetError } = await supabase.rpc('reset_ledger_data')
    if (resetError) setError(`Could not reset your data: ${resetError.message}`)
    else {
      setNotice('Your ledger has been reset.')
      await refresh()
    }
  }

  async function signOut() {
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(`Could not sign out: ${signOutError.message}`)
  }

  if (!supabase) {
    return <AccessScreen title="Connect your ledger" message="Add your Supabase project URL and publishable key to the deployment environment to continue." />
  }
  if (!authReady) return <main className="access-screen"><p>Opening your ledger…</p></main>
  if (!session) return <SignIn onSignedIn={setSession} />

  const income = sum(sales)
  const expensesByBucket = Object.fromEntries(BUCKETS.map((bucket) => [bucket, sum(spending.filter((entry) => entry.bucket === bucket))])) as Record<Bucket, number>
  const split = {
    Savings: settings.savings_percent,
    Expenses: settings.expenses_percent,
    Restocking: settings.restocking_percent,
  }
  const budgetFor = (bucket: Bucket) => income * split[bucket] / 100
  const saved = Math.max(0, budgetFor('Savings') - expensesByBucket.Savings)
  const filteredSales = periodItems(sales, period, (sale) => sale.sold_on)
  const filteredSpending = periodItems(spending, period, (entry) => entry.spent_on)
  const revenue = sum(filteredSales)
  const costOfRestocking = sum(filteredSpending.filter((entry) => entry.bucket === 'Restocking'))
  const operatingExpenses = sum(filteredSpending.filter((entry) => entry.bucket === 'Expenses'))
  const netProfit = revenue - costOfRestocking - operatingExpenses
  const margin = revenue ? netProfit / revenue * 100 : 0
  const filteredRecentSpending = spending.filter((entry) =>
    `${entry.bucket} ${entry.note} ${entry.spent_on}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  async function addSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const amount = Number(form.get('amount'))
    if (!supabase || !session || amount <= 0) return
    const { error: insertError } = await supabase.from('sales').insert({
      user_id: session.user.id,
      source: form.get('source') as Source,
      amount,
      sold_on: String(form.get('date')),
      note: String(form.get('note') || '').trim(),
    })
    if (insertError) setError(`Could not add sale: ${insertError.message}`)
    else {
      formElement.reset()
      setNotice('Sale added.')
      await refresh()
    }
  }

  async function addSpending(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const amount = Number(form.get('amount'))
    if (!supabase || !session || amount <= 0) return
    const { error: insertError } = await supabase.from('spending').insert({
      user_id: session.user.id,
      bucket: form.get('bucket') as Bucket,
      amount,
      spent_on: String(form.get('date')),
      note: String(form.get('note') || '').trim(),
    })
    if (insertError) setError(`Could not add spending: ${insertError.message}`)
    else {
      formElement.reset()
      setNotice('Spending added.')
      await refresh()
    }
  }

  async function addStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    if (!supabase || !session) return
    const { error: insertError } = await supabase.from('inventory').insert({
      user_id: session.user.id,
      source: form.get('source') as Source,
      item: String(form.get('item')).trim(),
      quantity: Number(form.get('quantity')),
      value_each: Number(form.get('value')),
      added_on: String(form.get('date')),
      note: String(form.get('note') || '').trim(),
    })
    if (insertError) setError(`Could not add stock: ${insertError.message}`)
    else {
      formElement.reset()
      setNotice('Stock item added.')
      await refresh()
    }
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">YOUR WORKSHOP, AT A GLANCE</p>
          <h1>Workshop Ledger</h1>
          <p className="tagline">Furniture, carpets and upholstery sales, all flowing into one budget and savings system.</p>
        </div>
        <button className="text-button signout-button" onClick={() => void signOut()}>Sign out</button>
      </header>

      <nav className="tabs" aria-label="Ledger sections">
        {(['Ledger', 'Inventory', 'P&L'] as const).map((item) => (
          <button key={item} className={`tab ${section === item ? 'active' : ''}`} aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{item}</button>
        ))}
      </nav>

      {error && <div className="message error-message" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {notice && <div className="message success-message" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
      {loading && <div className="loading-line" role="status">Updating your ledger…</div>}

      {section === 'Ledger' && (
        <>
          <section className="stat-grid ledger-stats" aria-label="Income summary">
            <Stat value={money(income)} label="Total income, all time" />
            <Stat value={money(sum(sales.filter((sale) => sale.sold_on.slice(0, 7) === today().slice(0, 7))))} label="This month" />
            <Stat value={money(saved)} label="Saved so far" />
          </section>

          <div className="ledger-grid">
            <div className="main-column">
              <section className="panel">
                <h2>Log a sale</h2>
                <form className="entry-form" onSubmit={addSale}>
                  <label>Source<select name="source">{SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
                  <label>Amount (R)<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
                  <label>Date<input name="date" type="date" defaultValue={today()} required /></label>
                  <label className="wide-field">Note (optional)<input name="note" maxLength={160} placeholder="e.g. Oak dining table" /></label>
                  <button className="primary-button" type="submit">＋ Add sale</button>
                </form>
              </section>

              <section className="content-section">
                <h2>Recent sales</h2>
                <RecordList
                  empty="Your sales will appear here once you log them."
                  records={sales}
                  render={(sale) => (
                    <RecordRow
                      title={`${sale.source}${sale.note ? ` — ${sale.note}` : ''}`}
                      date={sale.sold_on}
                      amount={money(sale.amount)}
                      onEdit={() => setEditing({ kind: 'sale', record: sale })}
                      onDelete={() => void deleteRecord('sale', sale.id)}
                    />
                  )}
                />
              </section>
            </div>

            <div className="side-column">
              <section className="panel summary-panel">
                <div className="section-heading"><h2>Income by source</h2><span className="total-label">{money(income)}<small>TOTAL</small></span></div>
                {SOURCES.map((source) => {
                  const sourceIncome = sum(sales.filter((sale) => sale.source === source))
                  return <Breakdown key={source} label={source} amount={sourceIncome} total={income} />
                })}
              </section>

              <section className="panel settings-panel">
                <h2>Savings goal</h2>
                <form key={settings.savings_goal} className="goal-form" onSubmit={(event) => {
                  event.preventDefault()
                  const amount = Number(new FormData(event.currentTarget).get('goal'))
                  if (amount >= 0) void saveSettings({ savings_goal: amount }).catch((saveError: Error) => setError(saveError.message))
                }}>
                  <label>Target amount (R)<input name="goal" type="number" min="0" step="0.01" defaultValue={settings.savings_goal || ''} placeholder="e.g. 50 000" /></label>
                  <button className="secondary-button" type="submit">Set</button>
                </form>
                {settings.savings_goal > 0 ? (
                  <div className="goal-progress">
                    <div className="goal-line"><span>{money(saved)} saved</span><span>{money(settings.savings_goal)} goal</span></div>
                    <div className="progress-track"><span style={{ width: `${Math.min(100, saved / settings.savings_goal * 100)}%` }} /></div>
                  </div>
                ) : <p className="muted-copy">Set a target to track progress toward it.</p>}
              </section>

              <section className="panel settings-panel">
                <h2>How income splits</h2>
                <form key={`${split.Savings}-${split.Expenses}-${split.Restocking}`} onSubmit={(event) => {
                  event.preventDefault()
                  const data = new FormData(event.currentTarget)
                  const savings = Number(data.get('savings'))
                  const expenses = Number(data.get('expenses'))
                  const restocking = Number(data.get('restocking'))
                  if ([savings, expenses, restocking].some((n) => n < 0 || n > 100) || savings + expenses + restocking !== 100) {
                    setError('Your split must add up to exactly 100%.')
                    return
                  }
                  void saveSettings({ savings_percent: savings, expenses_percent: expenses, restocking_percent: restocking }).catch((saveError: Error) => setError(saveError.message))
                }}>
                  <div className="split-fields">
                    {BUCKETS.map((bucket) => <label key={bucket}>{bucket}<span className="percent-input"><input name={bucket.toLowerCase()} type="number" min="0" max="100" defaultValue={split[bucket]} aria-label={`${bucket} percentage`} /><span>%</span></span></label>)}
                  </div>
                  <p className="split-total">Total: {Object.values(split).reduce((a, b) => a + b, 0)}%</p>
                  <button className="secondary-button" type="submit">Save split</button>
                </form>
              </section>

              <section className="panel budget-panel">
                <h2>Budget buckets</h2>
                {BUCKETS.map((bucket) => <div className="budget-row" key={bucket}>
                  <div className="budget-title"><strong>{bucket}</strong><span>{split[bucket]}%</span></div>
                  <div className="budget-amount">{money(budgetFor(bucket) - expensesByBucket[bucket])} left of {money(budgetFor(bucket))}</div>
                  <div className="progress-track"><span style={{ width: `${budgetFor(bucket) ? Math.max(0, Math.min(100, (budgetFor(bucket) - expensesByBucket[bucket]) / budgetFor(bucket) * 100)) : 0}%` }} /></div>
                </div>)}
              </section>

              <section className="panel">
                <h2>Log spending</h2>
                <form className="entry-form compact-form" onSubmit={addSpending}>
                  <label>Bucket<select name="bucket">{BUCKETS.map((bucket) => <option key={bucket}>{bucket}</option>)}</select></label>
                  <label>Amount (R)<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
                  <label>Date<input name="date" type="date" defaultValue={today()} required /></label>
                  <label className="wide-field">Note (optional)<input name="note" maxLength={160} placeholder="e.g. Fuel" /></label>
                  <button className="primary-button" type="submit">＋ Add spend</button>
                </form>
              </section>

              <section className="content-section">
                <div className="section-heading"><h2>Recent spending</h2><label className="search-field"><span className="sr-only">Search spending</span><input aria-label="Search spending" type="search" placeholder="Search spending…" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
                <RecordList empty={search ? 'No spending matches your search.' : 'Your spending will appear here once you add it.'} records={filteredRecentSpending} render={(entry) => (
                  <RecordRow
                    title={`${entry.bucket}${entry.note ? ` — ${entry.note}` : ''}`}
                    date={entry.spent_on}
                    amount={money(entry.amount)}
                    onEdit={() => setEditing({ kind: 'spending', record: entry })}
                    onDelete={() => void deleteRecord('spending', entry.id)}
                  />
                )} />
              </section>
            </div>
          </div>
        </>
      )}

      {section === 'Inventory' && (
        <>
          <section className="stat-grid inventory-stats" aria-label="Inventory summary">
            <Stat value={money(sum(stock.map((item) => ({ amount: item.quantity * item.value_each }))))} label="Total stock value" />
            <Stat value={String(stock.reduce((total, item) => total + item.quantity, 0))} label="Units in stock" />
            <Stat value={money(budgetFor('Restocking') - expensesByBucket.Restocking)} label="Available to restock" />
          </section>
          <div className="ledger-grid">
            <div className="main-column">
              <section className="panel">
                <h2>Add stock</h2>
                <form className="entry-form inventory-form" onSubmit={addStock}>
                  <label>Source<select name="source">{SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
                  <label className="wide-field">Item<input name="item" maxLength={120} placeholder="e.g. 3 piece lounge suite" required /></label>
                  <label>Quantity<input name="quantity" type="number" min="1" step="1" defaultValue="1" required /></label>
                  <label>Value each (R)<input name="value" type="number" min="0" step="0.01" placeholder="0.00" required /></label>
                  <label>Date added<input name="date" type="date" defaultValue={today()} required /></label>
                  <label className="wide-field">Note (optional)<input name="note" maxLength={160} /></label>
                  <button className="primary-button" type="submit">＋ Add item</button>
                </form>
              </section>
              <section className="content-section">
                <h2>All stock</h2>
                <RecordList empty="Your stock will appear here once you add an item." records={stock} render={(item) => (
                  <RecordRow
                    title={`${item.item}`}
                    subtitle={`${item.source} · Qty ${item.quantity}${item.note ? ` · ${item.note}` : ''}`}
                    date={item.added_on}
                    amount={money(item.quantity * item.value_each)}
                    onEdit={() => setEditing({ kind: 'stock', record: item })}
                    onDelete={() => void deleteRecord('stock', item.id)}
                  />
                )} />
              </section>
            </div>
            <aside className="side-column">
              <section className="panel summary-panel">
                <div className="section-heading"><h2>Stock by source</h2><span className="total-label">{money(sum(stock.map((item) => ({ amount: item.quantity * item.value_each }))))}<small>VALUE</small></span></div>
                {SOURCES.map((source) => {
                  const sourceItems = stock.filter((item) => item.source === source)
                  const value = sourceItems.reduce((total, item) => total + item.quantity * item.value_each, 0)
                  const units = sourceItems.reduce((total, item) => total + item.quantity, 0)
                  return <Breakdown key={source} label={`${source} · ${units} units`} amount={value} total={sum(stock.map((item) => ({ amount: item.quantity * item.value_each })))} />
                })}
              </section>
            </aside>
          </div>
        </>
      )}

      {section === 'P&L' && (
        <>
          <section className="stat-grid pnl-stats" aria-label="Profit and loss summary">
            <Stat value={money(revenue)} label="Revenue" />
            <Stat value={money(netProfit)} label="Net profit" />
            <Stat value={`${margin.toFixed(1)}%`} label="Net margin" />
          </section>
          <section className="panel pnl-panel">
            <div className="section-heading pnl-heading">
              <h2>Profit &amp; loss</h2>
              <div className="report-actions">
                <label className="period-select"><span className="sr-only">Report period</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{(['All time', 'This month', 'This year'] as const).map((item) => <option key={item}>{item}</option>)}</select></label>
                <button className="secondary-button" onClick={() => window.print()}>Print</button>
                <button className="secondary-button" onClick={() => exportReport(filteredSales, filteredSpending)}>Export spreadsheet</button>
              </div>
            </div>
            <div className="report-lines">
              <h3>Revenue</h3>
              {SOURCES.map((source) => <ReportLine key={source} label={source} amount={sum(filteredSales.filter((sale) => sale.source === source))} />)}
              <ReportLine label="Total revenue" amount={revenue} strong />
              <ReportLine label="Less: Cost of restocking" amount={-costOfRestocking} />
              <ReportLine label="Gross profit" amount={revenue - costOfRestocking} strong />
              <ReportLine label="Less: Operating expenses" amount={-operatingExpenses} />
              <ReportLine label="Net profit" amount={netProfit} strong final />
              <p className="margin-footnote">Net margin: {margin.toFixed(1)}%</p>
            </div>
          </section>
        </>
      )}

      <footer className="page-footer"><span>Private workshop ledger</span><button className="text-button danger-text" onClick={() => void resetData()}>Reset all data</button></footer>
      {editing && <RecordEditor key={`${editing.kind}-${editing.record.id}`} target={editing} onClose={() => setEditing(null)} onSave={(values) => saveEdit(editing, values)} onError={(message) => setError(message)} />}
    </main>
  )
}

function AccessScreen({ title, message }: { title: string; message: string }) {
  return <main className="access-screen"><div className="access-card"><p className="eyebrow">WORKSHOP LEDGER</p><h1>{title}</h1><p>{message}</p><p className="setup-hint">See <code>.env.example</code> and the setup guide in the README.</p></div></main>
}

function SignIn({ onSignedIn }: { onSignedIn: (session: Session | null) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: String(form.get('email')).trim(),
      password: String(form.get('password')),
    })
    if (signInError) setError(signInError.message)
    else onSignedIn(data.session)
    setBusy(false)
  }
  return (
    <main className="access-screen">
      <div className="access-card">
        <p className="eyebrow">YOUR WORKSHOP, AT A GLANCE</p>
        <h1>Workshop Ledger</h1>
        <p>Sign in to your private ledger. Your sales, stock and spending are kept in your own account.</p>
        {error && <div role="alert" className="message error-message">{error}</div>}
        <form className="login-form" onSubmit={submit}>
          <label>Email address<input name="email" type="email" autoComplete="username" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="setup-hint">Your owner account is created in the Supabase dashboard.</p>
      </div>
    </main>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="stat-card"><strong>{value}</strong><span>{label}</span></div>
}

function Breakdown({ label, amount, total }: { label: string; amount: number; total: number }) {
  const percentage = total ? amount / total * 100 : 0
  return <div className="breakdown-row">
    <div className="breakdown-heading"><span>{label}</span><span>{percentage.toFixed(percentage > 0 && percentage < 1 ? 1 : 0)}%</span></div>
    <div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} /></div>
    <strong>{money(amount)}</strong>
  </div>
}

function RecordList<T extends { id: string }>({ records, empty, render }: { records: T[]; empty: string; render: (record: T) => ReactNode }) {
  return <div className="record-list">{records.length ? records.map((record) => <div key={record.id}>{render(record)}</div>) : <p className="empty-state">{empty}</p>}</div>
}

function RecordRow({ title, subtitle, date, amount, onEdit, onDelete }: { title: string; subtitle?: string; date: string; amount: string; onEdit: () => void; onDelete: () => void }) {
  return <article className="record-row">
    <span className="record-marker" aria-hidden="true" />
    <div className="record-main"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}<time dateTime={date}>{dateLabel(date)}</time></div>
    <strong className="record-amount">{amount}</strong>
    <div className="record-actions"><button className="icon-button" aria-label={`Edit ${title}`} onClick={onEdit}>✎</button><button className="icon-button" aria-label={`Delete ${title}`} onClick={onDelete}>♧</button></div>
  </article>
}

function ReportLine({ label, amount, strong = false, final = false }: { label: string; amount: number; strong?: boolean; final?: boolean }) {
  return <div className={`report-line ${strong ? 'strong' : ''} ${final ? 'final' : ''}`}><span>{label}</span><span>{amount < 0 ? `(${money(Math.abs(amount))})` : money(amount)}</span></div>
}

function RecordEditor({ target, onClose, onSave, onError }: {
  target: EditTarget
  onClose: () => void
  onSave: (values: Record<string, string | number>) => Promise<void>
  onError: (message: string) => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')
    focusable()?.[0]?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Tab') {
        const elements = focusable()
        if (!elements?.length) return
        const first = elements[0]
        const last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    dialog?.addEventListener('keydown', handleKeyDown)
    return () => {
      dialog?.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [onClose])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    let values: Record<string, string | number>
    if (target.kind === 'sale') {
      values = { source: String(data.get('source')), amount: Number(data.get('amount')), sold_on: String(data.get('date')), note: String(data.get('note') || '').trim() }
    } else if (target.kind === 'spending') {
      values = { bucket: String(data.get('bucket')), amount: Number(data.get('amount')), spent_on: String(data.get('date')), note: String(data.get('note') || '').trim() }
    } else {
      values = { source: String(data.get('source')), item: String(data.get('item')).trim(), quantity: Number(data.get('quantity')), value_each: Number(data.get('value')), added_on: String(data.get('date')), note: String(data.get('note') || '').trim() }
    }
    try {
      await onSave(values)
    } catch (saveError) {
      onError(`Could not save changes: ${(saveError as Error).message}`)
    }
  }
  const record = target.record
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title" tabIndex={-1}>
      <div className="section-heading"><h2 id="edit-title">Edit {target.kind === 'sale' ? 'sale' : target.kind === 'spending' ? 'spending' : 'stock item'}</h2><button className="icon-button" aria-label="Close editor" onClick={onClose}>×</button></div>
      <form className="editor-form" onSubmit={(event) => void submit(event)}>
        {'source' in record && <label>Source<select name="source" defaultValue={record.source}>{SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>}
        {'bucket' in record && <label>Bucket<select name="bucket" defaultValue={record.bucket}>{BUCKETS.map((bucket) => <option key={bucket}>{bucket}</option>)}</select></label>}
        {'item' in record && <label>Item<input name="item" defaultValue={record.item} maxLength={120} required /></label>}
        {'amount' in record && <label>Amount (R)<input name="amount" type="number" min="0.01" step="0.01" defaultValue={record.amount} required /></label>}
        {'quantity' in record && <><label>Quantity<input name="quantity" type="number" min="1" step="1" defaultValue={record.quantity} required /></label><label>Value each (R)<input name="value" type="number" min="0" step="0.01" defaultValue={record.value_each} required /></label></>}
        <label>Date<input name="date" type="date" defaultValue={'sold_on' in record ? record.sold_on : 'spent_on' in record ? record.spent_on : record.added_on} required /></label>
        <label>Note (optional)<input name="note" defaultValue={record.note} maxLength={160} /></label>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Save changes</button></div>
      </form>
    </section>
  </div>
}

function periodItems<T>(items: T[], period: Period, getDate: (item: T) => string): T[] {
  if (period === 'All time') return items
  const now = today()
  const prefix = period === 'This month' ? now.slice(0, 7) : now.slice(0, 4)
  return items.filter((item) => getDate(item).startsWith(prefix))
}

function exportReport(sales: Sale[], spending: Spending[]) {
  const lines = [
    ['Type', 'Category', 'Date', 'Note', 'Amount (ZAR)'],
    ...sales.map((sale) => ['Sale', sale.source, sale.sold_on, sale.note, String(sale.amount)]),
    ...spending.map((entry) => ['Spending', entry.bucket, entry.spent_on, entry.note, String(-entry.amount)]),
  ]
  const csv = lines.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'workshop-ledger.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export default App
