'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import '../styles.css';
import './cheques.css';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const date = (value) => value ? new Date(value + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};
const statusLabels = {
  em_carteira: 'Em carteira',
  repassado: 'Repassado',
  compensacao_presumida: 'Compensação presumida',
  compensado_confirmado: 'Compensado (confirmado)',
  devolvido: 'Devolvido',
  cancelado: 'Cancelado',
};
const eventLabels = {
  criado: 'Cheque cadastrado',
  repassado: 'Repassado',
  devolvido: 'Devolução registrada',
  compensado_confirmado: 'Compensação confirmada',
  cancelado: 'Cancelamento registrado',
  alteracao_status: 'Situação alterada',
  alteracao_local: 'Localização alterada',
  alteracao_dados: 'Dados do cheque alterados',
};
const blankCheck = () => ({
  direction: 'recebido', check_number: '', bank_name: '', branch: '', account_number: '',
  amount: '', issue_date: '', due_date: '', returned_date: '', origin_client_id: '', issuer_name: '',
  issuer_kind: 'desconhecido', beneficiary_party_id: '', current_holder: 'Sany Embalagens',
  status: 'em_carteira', notes: '',
});
const blankParty = () => ({ name: '', party_type: 'cliente', document: '', phone: '', notes: '' });

export default function ChequesPage() {
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [page, setPage] = useState('painel');
  const [records, setRecords] = useState([]);
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ direction: 'todos', status: 'todos', client: '', supplier: '', from: '', to: '' });
  const [checkModal, setCheckModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankCheck());
  const [partyForm, setPartyForm] = useState(blankParty());
  const [historyCheck, setHistoryCheck] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedCheckIds, setSelectedCheckIds] = useState([]);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkDestinationId, setBulkDestinationId] = useState('');
  const [bulkDestinationText, setBulkDestinationText] = useState('');
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    const [checkResult, partyResult] = await Promise.all([
      supabase.from('sany_cheques_records_view').select('*').order('due_date', { ascending: true, nullsFirst: false }).limit(5000),
      supabase.from('sany_cheques_parties').select('*').eq('active', true).order('name'),
    ]);
    if (checkResult.error || partyResult.error) {
      setError(checkResult.error?.message || partyResult.error?.message || 'Não foi possível carregar os dados.');
    } else {
      setRecords(checkResult.data || []);
      setParties(partyResult.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  const clients = useMemo(() => parties.filter((p) => p.party_type === 'cliente'), [parties]);
  const suppliers = useMemo(() => parties.filter((p) => p.party_type === 'fornecedor'), [parties]);
  const partyNames = useMemo(() => new Map(parties.map((p) => [p.id, p.name])), [parties]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('pt-BR');
    return records.filter((r) => {
      const clientName = partyNames.get(r.origin_client_id) || '';
      const supplierName = partyNames.get(r.beneficiary_party_id) || '';
      const searchable = [r.check_number, r.bank_name, r.branch, r.account_number, r.issuer_name, clientName, supplierName, r.current_holder, r.notes].join(' ').toLocaleLowerCase('pt-BR');
      if (q && !searchable.includes(q)) return false;
      if (filters.direction !== 'todos' && r.direction !== filters.direction) return false;
      if (filters.status !== 'todos' && r.effective_status !== filters.status) return false;
      if (filters.client && r.origin_client_id !== filters.client) return false;
      if (filters.supplier && r.beneficiary_party_id !== filters.supplier) return false;
      if (filters.from && (!r.due_date || r.due_date < filters.from)) return false;
      if (filters.to && (!r.due_date || r.due_date > filters.to)) return false;
      return true;
    });
  }, [records, search, filters, partyNames]);

  const metrics = useMemo(() => {
    const sum = (rows) => rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
    return {
      total: records.length,
      inHand: records.filter((r) => r.status === 'em_carteira').length,
      repassed: records.filter((r) => r.status === 'repassado' && r.effective_status !== 'compensacao_presumida').length,
      presumed: records.filter((r) => r.effective_status === 'compensacao_presumida').length,
      returned: records.filter((r) => r.status === 'devolvido').length,
      inHandValue: sum(records.filter((r) => r.status === 'em_carteira')),
      repassedValue: sum(records.filter((r) => r.status === 'repassado' && r.effective_status !== 'compensacao_presumida')),
      presumedValue: sum(records.filter((r) => r.effective_status === 'compensacao_presumida')),
      returnedValue: sum(records.filter((r) => r.status === 'devolvido')),
    };
  }, [records]);

  async function login(event) {
    event.preventDefault();
    setError('');
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) setError(loginError.message);
  }

  async function logout() {
    await supabase.auth.signOut();
    setRecords([]);
    setParties([]);
  }

  function openNewCheck() {
    setEditing(null);
    setForm(blankCheck());
    setError('');
    setNotice('');
    setCheckModal(true);
  }

  function openEditCheck(record) {
    setEditing(record);
    setForm({
      direction: record.direction || 'recebido',
      check_number: record.check_number || '',
      bank_name: record.bank_name || '',
      branch: record.branch || '',
      account_number: record.account_number || '',
      amount: record.amount ?? '',
      issue_date: record.issue_date || '',
      due_date: record.due_date || '',
      returned_date: record.returned_date || '',
      origin_client_id: record.origin_client_id || '',
      issuer_name: record.issuer_name || '',
      issuer_kind: record.issuer_kind || 'desconhecido',
      beneficiary_party_id: record.beneficiary_party_id || '',
      current_holder: record.current_holder || 'Sany Embalagens',
      status: record.status || 'em_carteira',
      notes: record.notes || '',
    });
    setError('');
    setNotice('');
    setCheckModal(true);
  }

  async function saveCheck(event) {
    event.preventDefault();
    setError('');
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Informe um valor válido para o cheque.');
      return;
    }
    if (!form.due_date) {
      setError('Informe a data “Bom para” / vencimento.');
      return;
    }
    const beneficiary = parties.find((p) => p.id === form.beneficiary_party_id);
    let holder = (form.current_holder || '').trim() || 'Sany Embalagens';
    if (form.status === 'repassado' && !beneficiary && (!holder || holder === 'Sany Embalagens')) {
      setError('Informe o fornecedor ou onde o cheque foi repassado.');
      return;
    }
    if (form.status === 'em_carteira') holder = 'Sany Embalagens';
    if (form.status === 'repassado' && beneficiary) holder = beneficiary.name;
    if (form.status === 'compensado_confirmado' || form.status === 'cancelado') holder = holder || 'Sany Embalagens';

    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      direction: form.direction,
      check_number: form.check_number.trim() || null,
      bank_name: form.bank_name.trim() || null,
      branch: form.branch.trim() || null,
      account_number: form.account_number.trim() || null,
      amount,
      issue_date: form.issue_date || null,
      due_date: form.due_date || null,
      returned_date: form.status === 'devolvido' ? (form.returned_date || (editing?.status === 'devolvido' ? null : today())) : null,
      origin_client_id: form.direction === 'recebido' ? (form.origin_client_id || null) : null,
      issuer_name: form.issuer_name.trim() || null,
      issuer_kind: form.direction === 'emitido' ? 'sany' : form.issuer_kind,
      beneficiary_party_id: form.beneficiary_party_id || null,
      current_holder: holder,
      status: form.status,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: user?.id || null,
    };
    const result = editing
      ? await supabase.from('sany_cheques_records').update(payload).eq('id', editing.id)
      : await supabase.from('sany_cheques_records').insert({ ...payload, created_by: user?.id || null });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setCheckModal(false);
    setNotice(editing ? 'Cheque atualizado. O histórico foi preservado.' : 'Cheque cadastrado com sucesso.');
    await loadData();
  }

  const selectedChecks = useMemo(() => filteredRecords.filter((r) => selectedCheckIds.includes(r.id)), [filteredRecords, selectedCheckIds]);
  const selectedTotal = selectedChecks.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const selectedDueDates = selectedChecks.map((r) => r.due_date).filter(Boolean).map((d) => new Date(d + 'T00:00:00').getTime());
  const averageDueDate = selectedDueDates.length ? new Date(selectedDueDates.reduce((sum, d) => sum + d, 0) / selectedDueDates.length).toLocaleDateString('pt-BR') : 'Sem datas';

  async function saveBulkTransfer(event) {
    event.preventDefault();
    setError('');
    if (!selectedChecks.length) {
      setError('Selecione pelo menos um cheque.');
      return;
    }
    if (selectedChecks.some((r) => r.status !== 'em_carteira')) {
      setError('O lote só pode incluir cheques que estão em carteira. Revise a seleção.');
      return;
    }
    const destination = parties.find((p) => p.id === bulkDestinationId);
    const holder = destination?.name || bulkDestinationText.trim();
    if (!holder) {
      setError('Selecione o fornecedor/destinatário ou informe o destino.');
      return;
    }
    setBulkSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    let failed = [];
    for (const record of selectedChecks) {
      const { error: updateError } = await supabase.from('sany_cheques_records').update({
        status: 'repassado',
        beneficiary_party_id: destination?.id || null,
        current_holder: holder,
        notes: bulkNotes.trim() ? [record.notes, 'Repasse em lote: ' + bulkNotes.trim()].filter(Boolean).join('\n') : record.notes,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      }).eq('id', record.id).eq('status', 'em_carteira');
      if (updateError) failed.push((record.check_number || record.id) + ': ' + updateError.message);
    }
    setBulkSaving(false);
    if (failed.length) {
      setError('Alguns cheques não foram atualizados. Confira a listagem e tente novamente nos pendentes: ' + failed.join(' | '));
      await loadData();
      return;
    }
    setSelectedCheckIds([]);
    setBulkModal(false);
    setBulkDestinationId('');
    setBulkDestinationText('');
    setBulkNotes('');
    setNotice('Repasse em lote registrado para ' + selectedChecks.length + ' cheque(s), totalizando ' + money(selectedTotal) + '.');
    await loadData();
  }

  async function saveParty(event) {
    event.preventDefault();
    setError('');
    if (!partyForm.name.trim()) {
      setError('Informe o nome do cliente ou fornecedor.');
      return;
    }
    const { error: saveError } = await supabase.from('sany_cheques_parties').insert({
      name: partyForm.name.trim(),
      party_type: partyForm.party_type,
      document: partyForm.document.trim() || null,
      phone: partyForm.phone.trim() || null,
      notes: partyForm.notes.trim() || null,
    });
    if (saveError) setError(saveError.message);
    else {
      setPartyForm(blankParty());
      setNotice('Cadastro salvo.');
      await loadData();
    }
  }

  async function openHistory(record) {
    setHistoryCheck(record);
    setHistory([]);
    setHistoryLoading(true);
    const { data, error: historyError } = await supabase
      .from('sany_cheques_movements')
      .select('*')
      .eq('check_id', record.id)
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (historyError) setError(historyError.message);
    else setHistory(data || []);
    setHistoryLoading(false);
  }

  function exportCsv() {
    const headers = ['Tipo', 'Número', 'Banco', 'Agência', 'Conta', 'Valor', 'Emissão', 'Bom para', 'Data de devolução', 'Cliente de origem', 'Emitente', 'Fornecedor/destino', 'Local atual', 'Situação'];
    const rows = filteredRecords.map((r) => [
      r.direction === 'recebido' ? 'Recebido' : 'Emitido',
      r.check_number || '',
      r.bank_name || '',
      r.branch || '',
      r.account_number || '',
      Number(r.amount || 0).toFixed(2).replace('.', ','),
      r.issue_date || '',
      r.due_date || '',
      r.returned_date || '',
      partyNames.get(r.origin_client_id) || '',
      r.issuer_name || '',
      partyNames.get(r.beneficiary_party_id) || '',
      r.current_holder || '',
      statusLabels[r.effective_status] || r.effective_status,
    ]);
    const csv = [headers, ...rows].map((row) => row.map((value) => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sany-cheques-' + today() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!sessionReady) return <main className="login"><div className="loginbox">Carregando acesso…</div></main>;
  if (!session) return (
    <main className="login">
      <form className="loginbox" onSubmit={login}>
        <div className="logo">SANY <span>CHEQUES</span></div>
        <p className="muted">Controle interno de cheques e movimentações.</p>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
        <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" style={{ width: '100%' }}>Entrar</button>
        <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>Use o mesmo acesso interno do SANY CONTAS.</p>
      </form>
    </main>
  );

  return (
    <div className="app sany-cheques-app">
      <aside>
        <div className="logo">SANY <span>CHEQUES</span></div>
        <small>Rastreamento e controle</small>
        {[
          ['painel', 'Visão geral'],
          ['cheques', 'Cheques'],
          ['relatorios', 'Relatórios'],
          ['cadastros', 'Clientes e fornecedores'],
        ].map(([key, label]) => <button key={key} className={'nav ' + (page === key ? 'active' : '')} onClick={() => { setPage(key); setError(''); }}>{label}</button>)}
        <a className="nav" href="/">← Voltar ao SANY CONTAS</a>
        <button className="logout" onClick={logout}>Sair</button>
      </aside>

      <main className="main">
        <header>
          <h1>{page === 'painel' ? 'Visão geral' : page === 'cheques' ? 'Controle de cheques' : page === 'relatorios' ? 'Relatórios' : 'Clientes e fornecedores'}</h1>
          <span>Rastreamento de cheques recebidos, repassados e emitidos pela Sany.</span>
        </header>

        {error && <div className="card" style={{ color: '#b42318', marginTop: 0 }}>{error}</div>}
        {notice && <div className="card" style={{ color: '#027a48', marginTop: 0 }}>{notice}</div>}

        {page === 'painel' && <>
          <div className="grid">
            <Metric label="Cheques cadastrados" value={metrics.total} />
            <MetricButton label="Em carteira" value={metrics.inHand + ' · ' + money(metrics.inHandValue)} onClick={() => { setPage('cheques'); setFilters({ ...filters, status: 'em_carteira' }); setSearch(''); }} />
            <Metric label="Repassados, aguardando" value={metrics.repassed + ' · ' + money(metrics.repassedValue)} />
            <Metric label="Compensação presumida" value={metrics.presumed + ' · ' + money(metrics.presumedValue)} />
          </div>
          <div className="grid" style={{ marginTop: 14 }}>
            <MetricButton label="Devolvidos" value={metrics.returned + ' · ' + money(metrics.returnedValue)} onClick={() => { setPage('cheques'); setFilters({ ...filters, status: 'devolvido' }); setSearch(''); }} />
            <Metric label="Clientes cadastrados" value={clients.length} />
            <Metric label="Fornecedores cadastrados" value={suppliers.length} />
            <MetricButton label="Compensados" value={records.filter((r) => r.status === 'compensado_confirmado').length + ' · ' + money(records.filter((r) => r.status === 'compensado_confirmado').reduce((sum, r) => sum + Number(r.amount || 0), 0))} onClick={() => { setPage('cheques'); setFilters({ ...filters, status: 'compensado_confirmado' }); setSearch(''); }} />
          </div>
          <Card title="Cheques próximos do vencimento ou vencidos" actions={<button className="primary" onClick={openNewCheck}>+ Cadastrar cheque</button>}>
            <CheckTable rows={records.filter((r) => r.status !== 'cancelado').slice().sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31')).slice(0, 12)} partyNames={partyNames} onEdit={openEditCheck} onHistory={openHistory} />
          </Card>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>“Compensação presumida” é uma estimativa operacional após 45 dias do vencimento, não uma confirmação bancária. Só se aplica a cheques repassados.</p>
        </>}

        {page === 'cheques' && <>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="cardhead">
              <h2>Buscar e filtrar</h2>
              <div className="rowactions"><button className="secondary" onClick={exportCsv}>Exportar CSV/Excel</button><button className="primary" onClick={openNewCheck}>+ Novo cheque</button></div>
            </div>
            <div className="reportfilters sany-cheques-filters">
              <label>Busca geral<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Número, banco, cliente, fornecedor…" /></label>
              <label>Tipo<select value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}><option value="todos">Todos</option><option value="recebido">Recebidos</option><option value="emitido">Emitidos pela Sany</option></select></label>
              <label>Situação<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="todos">Todas</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label>Cliente de origem<select value={filters.client} onChange={(e) => setFilters({ ...filters, client: e.target.value })}><option value="">Todos os clientes</option>{clients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>Fornecedor/destino<select value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}><option value="">Todos os fornecedores</option>{suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>Vencimento de<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
              <label>Vencimento até<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
              <button className="secondary clearfilters" onClick={() => { setSearch(''); setFilters({ direction: 'todos', status: 'todos', client: '', supplier: '', from: '', to: '' }); }}>Limpar filtros</button>
            </div>
          </div>
          <div className="grid sany-cheques-summary">
            <Metric label="Registros filtrados" value={filteredRecords.length} />
            <Metric label="Valor filtrado" value={money(filteredRecords.reduce((sum, r) => sum + Number(r.amount || 0), 0))} />
            <Metric label="Pendentes de confirmação" value={filteredRecords.filter((r) => ['repassado', 'compensacao_presumida'].includes(r.effective_status)).length} />
            <Metric label="Devolvidos" value={filteredRecords.filter((r) => r.effective_status === 'devolvido').length} />
          </div>
          {selectedCheckIds.length > 0 && <div className="card sany-cheques-bulkbar">
            <div><strong>{selectedChecks.length} cheque(s) selecionado(s)</strong><span>Total: {money(selectedTotal)} · Vencimento médio: {averageDueDate}</span></div>
            <div className="rowactions"><button className="secondary" onClick={() => setSelectedCheckIds([])}>Limpar seleção</button><button className="primary" onClick={() => { setBulkDestinationId(''); setBulkDestinationText(''); setBulkNotes(''); setBulkModal(true); }}>Repassar selecionados</button></div>
          </div>}
          <Card title="Relação de cheques"><CheckTable rows={filteredRecords} partyNames={partyNames} onEdit={openEditCheck} onHistory={openHistory} selectable selectedIds={selectedCheckIds} onToggleSelect={(id, checked) => setSelectedCheckIds((old) => checked ? [...new Set([...old, id])] : old.filter((x) => x !== id))} onToggleAll={(checked) => setSelectedCheckIds((old) => checked ? [...new Set([...old, ...filteredRecords.filter((r) => r.status === 'em_carteira').map((r) => r.id)])] : old.filter((id) => !filteredRecords.some((r) => r.id === id)))} />
        </>}

        {page === 'relatorios' && <>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="cardhead"><h2>Relatório por cliente, fornecedor e vencimento</h2><button className="secondary" onClick={exportCsv}>Exportar CSV/Excel</button></div>
            <div className="reportfilters sany-cheques-filters">
              <label>Cliente<select value={filters.client} onChange={(e) => setFilters({ ...filters, client: e.target.value })}><option value="">Todos</option>{clients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>Fornecedor<select value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}><option value="">Todos</option>{suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>Data “Bom para” a partir de<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
              <label>Até<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
              <label>Situação<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="todos">Todas</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label>Tipo<select value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}><option value="todos">Todos</option><option value="recebido">Recebidos</option><option value="emitido">Emitidos</option></select></label>
            </div>
          </div>
          <div className="grid sany-cheques-summary">
            <Metric label="Quantidade" value={filteredRecords.length} />
            <Metric label="Valor total" value={money(filteredRecords.reduce((sum, r) => sum + Number(r.amount || 0), 0))} />
            <Metric label="Em carteira" value={money(filteredRecords.filter((r) => r.status === 'em_carteira').reduce((sum, r) => sum + Number(r.amount || 0), 0))} />
            <Metric label="Compensação presumida" value={money(filteredRecords.filter((r) => r.effective_status === 'compensacao_presumida').reduce((sum, r) => sum + Number(r.amount || 0), 0))} />
          </div>
          <Card title="Resultado do relatório"><CheckTable rows={filteredRecords} partyNames={partyNames} onEdit={openEditCheck} onHistory={openHistory} /></Card>
        </>}

        {page === 'cadastros' && <>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="cardhead"><h2>Novo cliente ou fornecedor</h2></div>
            <form className="form" onSubmit={saveParty}>
              <label>Tipo<select value={partyForm.party_type} onChange={(e) => setPartyForm({ ...partyForm, party_type: e.target.value })}><option value="cliente">Cliente</option><option value="fornecedor">Fornecedor</option><option value="outro">Outro</option></select></label>
              <label>Nome<input value={partyForm.name} onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })} required /></label>
              <label>CNPJ/CPF (opcional)<input value={partyForm.document} onChange={(e) => setPartyForm({ ...partyForm, document: e.target.value })} /></label>
              <label>Telefone (opcional)<input value={partyForm.phone} onChange={(e) => setPartyForm({ ...partyForm, phone: e.target.value })} /></label>
              <label className="wide">Observações<textarea value={partyForm.notes} onChange={(e) => setPartyForm({ ...partyForm, notes: e.target.value })} /></label>
              <button className="primary" type="submit">Salvar cadastro</button>
            </form>
          </div>
          <Card title="Clientes cadastrados"><PartyTable rows={clients} /></Card>
          <Card title="Fornecedores cadastrados"><PartyTable rows={suppliers} /></Card>
        </>}
        {loading && <div className="loading">Atualizando dados…</div>}
      </main>

      {checkModal && <div className="modalbackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setCheckModal(false); }}>
        <section className="modal sany-cheques-modal">
          <div className="modalhead"><h2>{editing ? 'Editar cheque' : 'Cadastrar cheque'}</h2><button className="iconbutton" onClick={() => setCheckModal(false)}>×</button></div>
          <form className="customerform" onSubmit={saveCheck}>
            <label>Tipo<select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value, issuer_kind: e.target.value === 'emitido' ? 'sany' : 'desconhecido' })}><option value="recebido">Recebido de cliente/terceiro</option><option value="emitido">Emitido pela Sany</option></select></label>
            <label>Número do cheque<input value={form.check_number} onChange={(e) => setForm({ ...form, check_number: e.target.value })} /></label>
            <label>Banco<input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></label>
            <label>Agência<input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} /></label>
            <label>Conta<input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></label>
            <label>Valor (R$)<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></label>
            <label>Data de emissão<input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></label>
            <label>“Bom para” / vencimento<input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required /></label>
            {form.direction === 'recebido' && <label>Cliente que entregou<select value={form.origin_client_id} onChange={(e) => setForm({ ...form, origin_client_id: e.target.value })}><option value="">Selecione (opcional)</option>{clients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
            {form.direction === 'recebido' && <label>Tipo de emitente<select value={form.issuer_kind} onChange={(e) => setForm({ ...form, issuer_kind: e.target.value })}><option value="cliente">O próprio cliente</option><option value="terceiro">Terceiro</option><option value="desconhecido">Não informado</option></select></label>}
            <label>Nome do titular/emitente<input value={form.issuer_name} onChange={(e) => setForm({ ...form, issuer_name: e.target.value })} placeholder={form.direction === 'emitido' ? 'Sany Embalagens' : 'Titular impresso no cheque'} /></label>
            <label>Fornecedor/destino<select value={form.beneficiary_party_id} onChange={(e) => setForm({ ...form, beneficiary_party_id: e.target.value })}><option value="">Ainda não repassado / não informado</option>{suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Situação<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{Object.entries(statusLabels).filter(([key]) => key !== 'compensacao_presumida').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            {form.status === 'devolvido' && <label>Data da devolução<input type="date" value={form.returned_date} onChange={(e) => setForm({ ...form, returned_date: e.target.value })} /></label>}
            <label>Onde está o cheque<input value={form.current_holder} onChange={(e) => setForm({ ...form, current_holder: e.target.value })} placeholder="Ex.: Sany Embalagens / fornecedor" /></label>
            <label className="wide">Observações<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            <div className="modalactions wide">
              <button type="button" className="secondary" onClick={() => setCheckModal(false)}>Cancelar</button>
              <button type="submit" className="primary">Salvar cheque</button>
            </div>
          </form>
          <p className="muted" style={{ fontSize: 12 }}>A compensação presumida é calculada automaticamente após 45 dias corridos do vencimento, somente para cheques repassados. Ela não confirma compensação bancária.</p>
        </section>
      </div>}

      {bulkModal && <div className="modalbackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !bulkSaving) setBulkModal(false); }}>
        <section className="modal sany-cheques-modal">
          <div className="modalhead"><h2>Repassar cheques em lote</h2><button className="iconbutton" disabled={bulkSaving} onClick={() => setBulkModal(false)}>×</button></div>
          <div className="sany-cheques-bulk-summary">
            <strong>{selectedChecks.length} cheque(s) selecionado(s)</strong>
            <span>Valor total: {money(selectedTotal)}</span>
            <span>Vencimento médio: {averageDueDate}</span>
            <span>Período: {selectedChecks.some((r) => r.due_date) ? date(selectedChecks.filter((r) => r.due_date).map((r) => r.due_date).sort()[0]) + ' a ' + date(selectedChecks.filter((r) => r.due_date).map((r) => r.due_date).sort().slice(-1)[0]) : 'Sem datas de vencimento'}</span>
          </div>
          <form className="customerform" onSubmit={saveBulkTransfer}>
            <label>Fornecedor cadastrado<select value={bulkDestinationId} onChange={(e) => { setBulkDestinationId(e.target.value); if (e.target.value) setBulkDestinationText(''); }}><option value="">Outro destino / informar abaixo</option>{suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Destino (se não houver cadastro)<input value={bulkDestinationText} onChange={(e) => { setBulkDestinationText(e.target.value); if (e.target.value) setBulkDestinationId(''); }} placeholder="Nome do fornecedor ou local" /></label>
            <label className="wide">Observação do lote (opcional)<textarea value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} placeholder="Ex.: repassados juntos no pagamento desta compra" /></label>
            <div className="modalactions wide"><button type="button" className="secondary" disabled={bulkSaving} onClick={() => setBulkModal(false)}>Cancelar</button><button type="submit" className="primary" disabled={bulkSaving}>{bulkSaving ? 'Registrando…' : 'Confirmar repasse do lote'}</button></div>
          </form>
          <p className="muted" style={{ fontSize: 12 }}>Só serão repassados cheques que ainda estejam em carteira. Cada cheque mantém seu próprio histórico.</p>
        </section>
      </div>}
      {historyCheck && <div className="modalbackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setHistoryCheck(null); }}>
        <section className="modal">
          <div className="modalhead"><div><h2>Histórico do cheque</h2><small className="muted">Nº {historyCheck.check_number || 'não informado'} · {money(historyCheck.amount)}</small></div><button className="iconbutton" onClick={() => setHistoryCheck(null)}>×</button></div>
          {historyLoading ? <p>Carregando histórico…</p> : history.length ? <div className="sany-cheques-timeline">{history.map((item) => <div className="sany-cheques-timeline-item" key={item.id}><strong>{eventLabels[item.event_type] || item.event_type}</strong><span>{date(item.event_date)} · {item.from_holder ? item.from_holder + ' → ' : ''}{item.to_holder || ''}</span>{item.notes && <p>{item.notes}</p>}</div>)}</div> : <p className="muted">Nenhuma movimentação registrada.</p>}
          <div className="modalactions"><button className="secondary" onClick={() => setHistoryCheck(null)}>Fechar</button></div>
        </section>
      </div>}
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="metric"><small>{label}</small><strong>{value}</strong></div>;
}
function MetricButton({ label, value, onClick }) {
  return <button type="button" className="metric metric-button" onClick={onClick} title={'Ver cheques: ' + label}><small>{label}</small><strong>{value}</strong></button>;
}
function Card({ title, actions, children }) {
  return <section className="card"><div className="cardhead"><h2>{title}</h2>{actions}</div>{children}</section>;
}
function CheckTable({ rows, partyNames, onEdit, onHistory, selectable = false, selectedIds = [], onToggleSelect, onToggleAll }) {
  const eligibleRows = rows.filter((r) => r.status === 'em_carteira');
  const allEligibleSelected = eligibleRows.length > 0 && eligibleRows.every((r) => selectedIds.includes(r.id));
  return <div className="tablewrap"><table><thead><tr>{selectable && <th><input type="checkbox" aria-label="Selecionar todos os cheques em carteira desta lista" checked={allEligibleSelected} onChange={(e) => onToggleAll?.(e.target.checked)} /></th>}<th>Bom para</th><th>Número</th><th>Cliente/origem</th><th>Emitente</th><th>Valor</th><th>Destino/local</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
    {rows.length ? rows.map((r) => <tr key={r.id}>
      {selectable && <td>{r.status === 'em_carteira' ? <input type="checkbox" aria-label={'Selecionar cheque ' + (r.check_number || '')} checked={selectedIds.includes(r.id)} onChange={(e) => onToggleSelect?.(r.id, e.target.checked)} /> : <span title="Somente cheques em carteira podem ser selecionados para repasse">—</span>}</td>}
      <td>{date(r.due_date)}</td><td><strong>{r.check_number || '—'}</strong><small className="subtext">{r.bank_name || 'Banco não informado'}</small></td>
      <td>{partyNames.get(r.origin_client_id) || (r.direction === 'emitido' ? 'Sany Embalagens' : '—')}</td>
      <td>{r.issuer_name || '—'}<small className="subtext">{r.issuer_kind === 'terceiro' ? 'Terceiro' : r.direction === 'emitido' ? 'Cheque próprio' : ''}</small></td>
      <td><strong>{money(r.amount)}</strong></td><td>{r.current_holder || '—'}<small className="subtext">{partyNames.get(r.beneficiary_party_id) ? 'Destino: ' + partyNames.get(r.beneficiary_party_id) : (r.direction === 'recebido' ? 'Recebido' : 'Emitido pela Sany')}</small></td>
      <td><span className={'status-badge ' + (r.effective_status === 'devolvido' || r.effective_status === 'cancelado' ? 'cancelled' : r.effective_status === 'compensacao_presumida' ? 'due-soon' : r.effective_status === 'compensado_confirmado' ? 'active' : '')}>{statusLabels[r.effective_status] || r.effective_status}</span>{r.returned_date && <small className="subtext">Devolvido em {date(r.returned_date)}</small>}</td>
      <td><div className="rowactions"><button className="secondary small" onClick={() => onEdit(r)}>Editar</button><button className="secondary small" onClick={() => onHistory(r)}>Histórico</button></div></td>
    </tr>) : <tr><td colSpan={selectable ? 9 : 8} className="empty">Nenhum cheque encontrado para esses filtros.</td></tr>}
  </tbody></table></div>;
}
function PartyTable({ rows }) {
  return <div className="tablewrap"><table><thead><tr><th>Nome</th><th>Documento</th><th>Telefone</th><th>Observações</th></tr></thead><tbody>
    {rows.length ? rows.map((p) => <tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.document || '—'}</td><td>{p.phone || '—'}</td><td>{p.notes || '—'}</td></tr>) : <tr><td colSpan="4" className="empty">Nenhum cadastro nesta categoria.</td></tr>}
  </tbody></table></div>;
}
