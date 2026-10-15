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
const blankParty = () => ({ name: '', party_type: 'cliente', customer_group_id: '', new_customer_group_name: '', document: '', phone: '', notes: '' });

export default function ChequesPage() {
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [page, setPage] = useState('painel');
  const [records, setRecords] = useState([]);
  const [parties, setParties] = useState([]);
  const [customerGroups, setCustomerGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ direction: 'todos', status: 'todos', client: '', supplier: '', from: '', to: '' });
  const [checkModal, setCheckModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankCheck());
  const [partyForm, setPartyForm] = useState(blankParty());
  const [editingParty, setEditingParty] = useState(null);
  const [historyCheck, setHistoryCheck] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedCheckIds, setSelectedCheckIds] = useState([]);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkDestinationId, setBulkDestinationId] = useState('');
  const [bulkDestinationText, setBulkDestinationText] = useState('');
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [paymentSelectedIds, setPaymentSelectedIds] = useState([]);
  const [paymentDestination, setPaymentDestination] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentInvoiceTotal, setPaymentInvoiceTotal] = useState('');
  const [paymentMethods, setPaymentMethods] = useState([{ id: 1, line_type: 'payment', method: 'PIX', amount: '', reference: '' }]);
  const [paymentMethodNextId, setPaymentMethodNextId] = useState(2);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentBatches, setPaymentBatches] = useState([]);
  const [paymentBatchDetails, setPaymentBatchDetails] = useState(null);
  const [paymentBatchDetailLoading, setPaymentBatchDetailLoading] = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState(null);
  const [deletingCheckId, setDeletingCheckId] = useState(null);

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
    const [checkResult, partyResult, groupResult] = await Promise.all([
      supabase.from('sany_cheques_records_view').select('*').order('due_date', { ascending: true, nullsFirst: false }).limit(5000),
      supabase.from('sany_cheques_parties').select('*').eq('active', true).order('name'),
      supabase.from('sany_cheques_customer_groups').select('*').eq('active', true).order('name'),
    ]);
    if (checkResult.error || partyResult.error || groupResult.error) {
      setError(checkResult.error?.message || partyResult.error?.message || groupResult.error?.message || 'Não foi possível carregar os dados.');
    } else {
      setRecords(checkResult.data || []);
      setParties(partyResult.data || []);
      setCustomerGroups(groupResult.data || []);
      const batchResult = await supabase.from('sany_cheques_payment_batches').select('*, sany_cheques_payment_batch_items(id)').order('created_at', { ascending: false }).limit(50);
      if (!batchResult.error) setPaymentBatches(batchResult.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  const clients = useMemo(() => parties.filter((p) => p.party_type === 'cliente'), [parties]);
  const suppliers = useMemo(() => parties.filter((p) => p.party_type === 'fornecedor'), [parties]);
  const partyNames = useMemo(() => new Map(parties.map((p) => [p.id, p.name])), [parties]);
  const customerGroupNames = useMemo(() => new Map(customerGroups.map((g) => [g.id, g.name])), [customerGroups]);
  const partyGroupNames = useMemo(() => new Map(parties.map((p) => [p.id, customerGroupNames.get(p.customer_group_id) || p.customer_group_name || ''])), [parties, customerGroupNames]);

  const activeRecords = useMemo(() => records.filter((r) => !r.archived_at), [records]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('pt-BR');
    return activeRecords.filter((r) => {
      const clientName = partyNames.get(r.origin_client_id) || '';
      const supplierName = partyNames.get(r.beneficiary_party_id) || '';
      const clientGroupName = partyGroupNames.get(r.origin_client_id) || '';
      const searchable = [r.check_number, r.bank_name, r.branch, r.account_number, r.issuer_name, clientName, clientGroupName, supplierName, r.current_holder, r.notes].join(' ').toLocaleLowerCase('pt-BR');
      if (q && !searchable.includes(q)) return false;
      if (filters.direction !== 'todos' && r.direction !== filters.direction) return false;
      if (filters.status !== 'todos' && r.effective_status !== filters.status) return false;
      if (filters.client && r.origin_client_id !== filters.client) return false;
      if (filters.supplier) {
        if (filters.supplier.startsWith('destination:')) {
          const destination = filters.supplier.slice('destination:'.length).toLocaleLowerCase('pt-BR');
          if ((r.current_holder || '').trim().toLocaleLowerCase('pt-BR') !== destination) return false;
        } else if (r.beneficiary_party_id !== filters.supplier) return false;
      }
      if (filters.from && (!r.due_date || r.due_date < filters.from)) return false;
      if (filters.to && (!r.due_date || r.due_date > filters.to)) return false;
      return true;
    });
  }, [activeRecords, search, filters, partyNames, partyGroupNames]);

  const metrics = useMemo(() => {
    const sum = (rows) => rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
    return {
      total: activeRecords.length,
      inHand: activeRecords.filter((r) => r.status === 'em_carteira').length,
      repassed: activeRecords.filter((r) => r.status === 'repassado' && r.effective_status !== 'compensacao_presumida').length,
      presumed: activeRecords.filter((r) => r.effective_status === 'compensacao_presumida').length,
      returned: activeRecords.filter((r) => r.status === 'devolvido').length,
      inHandValue: sum(activeRecords.filter((r) => r.status === 'em_carteira')),
      repassedValue: sum(activeRecords.filter((r) => r.status === 'repassado' && r.effective_status !== 'compensacao_presumida')),
      presumedValue: sum(activeRecords.filter((r) => r.effective_status === 'compensacao_presumida')),
      returnedValue: sum(activeRecords.filter((r) => r.status === 'devolvido')),
    };
  }, [activeRecords]);

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

  const paymentEligible = useMemo(() => filteredRecords.filter((r) => r.status === 'em_carteira' && r.direction === 'recebido'), [filteredRecords]);
  const paymentSelected = useMemo(() => paymentEligible.filter((r) => paymentSelectedIds.includes(r.id)), [paymentEligible, paymentSelectedIds]);
  const paymentTotal = paymentSelected.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  async function savePaymentBatch(event) {
    event.preventDefault();
    setError('');
    if (!paymentDestination.trim()) { setError('Informe o fornecedor/destino deste pagamento.'); return; }
    const normalizedMethods = paymentMethods
      .filter((m) => String(m.amount).trim() !== '')
      .map((m) => ({ line_type: m.line_type, method: m.method, amount: Number(m.amount), reference: m.reference.trim() || null }));
    if (paymentMethods.some((m) => String(m.amount).trim() !== '' && (!Number.isFinite(Number(m.amount)) || Number(m.amount) <= 0))) {
      setError('Confira os valores das formas de pagamento: todos precisam ser maiores que zero.'); return;
    }
    if (paymentMethods.some((m) => String(m.amount).trim() === '' && m.reference.trim() !== '')) {
      setError('Informe o valor de cada forma de pagamento que você preencher.'); return;
    }
    if (!paymentSelected.length && normalizedMethods.filter((m) => m.line_type === 'payment').length === 0) {
      setError('Selecione cheques ou informe ao menos uma forma de pagamento.'); return;
    }
    const settlementTotal = paymentTotal + normalizedMethods.reduce((sum, m) => sum + m.amount, 0);
    if (!Number(paymentInvoiceTotal) || Math.abs(Number(paymentInvoiceTotal) - settlementTotal) > 0.009) {
      setError('A soma dos cheques, outras formas de pagamento e abatimentos precisa ser igual ao valor total informado.'); return;
    }
    const matchingSupplier = suppliers.find((p) => p.name.trim().toLocaleLowerCase('pt-BR') === paymentDestination.trim().toLocaleLowerCase('pt-BR'));
    setPaymentSaving(true);
    const { data: batchId, error: batchError } = await supabase.rpc('sany_cheques_register_payment_batch_v2', {
      p_check_ids: paymentSelected.map((r) => r.id),
      p_destination: paymentDestination.trim(),
      p_destination_party_id: matchingSupplier?.id || null,
      p_notes: paymentNotes.trim() || null,
      p_invoice_total: Number(paymentInvoiceTotal),
      p_methods: normalizedMethods,
    });
    setPaymentSaving(false);
    if (batchError) { setError(batchError.message); return; }
    setPaymentSelectedIds([]);
    setPaymentDestination('');
    setPaymentNotes('');
    setPaymentInvoiceTotal('');
    setPaymentMethods([{ id: 1, line_type: 'payment', method: 'PIX', amount: '', reference: '' }]);
    setPaymentMethodNextId(2);
    setNotice('Ordem registrada com ' + paymentSelected.length + ' cheque(s) e formas de pagamento adicionais. Total: ' + money(Number(paymentInvoiceTotal)) + '.');
    await loadData();
    setPaymentBatchDetails(null);
  }

  async function openPaymentBatch(batch) {
    setPaymentBatchDetails({ batch, items: [] });
    setPaymentBatchDetailLoading(true);
    const { data: items, error: itemsError } = await supabase.from('sany_cheques_payment_batch_items').select('*').eq('batch_id', batch.id).order('created_at');
    if (itemsError) {
      setError(itemsError.message);
      setPaymentBatchDetailLoading(false);
      return;
    }
    const { data: methods, error: methodsError } = await supabase.from('sany_cheques_payment_batch_methods').select('*').eq('batch_id', batch.id).order('created_at');
    if (methodsError) setError(methodsError.message);
    const ids = (items || []).map((i) => i.check_id);
    let checkMap = new Map();
    if (ids.length) {
      const { data: checks, error: checksError } = await supabase.from('sany_cheques_records_view').select('id,check_number,bank_name,amount,due_date,current_holder,status,effective_status').in('id', ids);
      if (checksError) setError(checksError.message);
      else checkMap = new Map((checks || []).map((r) => [r.id, r]));
    }
    setPaymentBatchDetails({ batch, items: (items || []).map((item) => ({ ...item, check: checkMap.get(item.check_id) || null })), methods: methods || [] });
    setPaymentBatchDetailLoading(false);
  }

  async function deletePaymentBatch(batch) {
    const confirmed = window.confirm(
      'Excluir o lote para ' + batch.destination + ' (' + batch.check_count + ' cheque(s), ' + money(batch.total_amount) + ')?\\n\\nOs cheques que ainda estiverem exatamente neste lote voltarão para “Em carteira”. Se algum tiver sido movimentado depois, a exclusão será bloqueada.'
    );
    if (!confirmed) return;
    setError('');
    setNotice('');
    setDeletingBatchId(batch.id);
    const { error: deleteError } = await supabase.rpc('sany_cheques_delete_payment_batch', {
      p_batch_id: batch.id,
    });
    setDeletingBatchId(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setPaymentBatchDetails(null);
    setNotice('Lote excluído. Os cheques elegíveis voltaram para Em carteira e o histórico das movimentações foi preservado.');
    await loadData();
  }

  function openEditParty(party) {
    setEditingParty(party);
    setPartyForm({
      name: party.name || '',
      party_type: party.party_type || 'cliente',
      customer_group_id: party.customer_group_id || '',
      new_customer_group_name: '',
      document: party.document || '',
      phone: party.phone || '',
      notes: party.notes || '',
    });
    setError('');
    setNotice('');
  }

  async function saveParty(event) {
    event.preventDefault();
    setError('');
    if (!partyForm.name.trim()) {
      setError('Informe o nome do cliente ou fornecedor.');
      return;
    }
    let groupId = partyForm.party_type === 'cliente' ? (partyForm.customer_group_id || null) : null;
    const newGroupName = partyForm.party_type === 'cliente' ? partyForm.new_customer_group_name.trim() : '';
    if (newGroupName) {
      const existingGroup = customerGroups.find((g) => g.name.trim().toLocaleLowerCase('pt-BR') === newGroupName.toLocaleLowerCase('pt-BR'));
      if (existingGroup) {
        groupId = existingGroup.id;
      } else {
        const { data: createdGroup, error: groupError } = await supabase.from('sany_cheques_customer_groups').insert({ name: newGroupName }).select('id').single();
        if (groupError) { setError('Não foi possível criar o grupo: ' + groupError.message); return; }
        groupId = createdGroup.id;
      }
    }
    const payload = {
      name: partyForm.name.trim(),
      party_type: partyForm.party_type,
      customer_group_id: groupId,
      customer_group_name: null,
      document: partyForm.document.trim() || null,
      phone: partyForm.phone.trim() || null,
      notes: partyForm.notes.trim() || null,
    };
    const result = editingParty
      ? await supabase.from('sany_cheques_parties').update(payload).eq('id', editingParty.id)
      : await supabase.from('sany_cheques_parties').insert(payload);
    if (result.error) setError(result.error.message);
    else {
      setPartyForm(blankParty());
      setEditingParty(null);
      setNotice(editingParty ? 'Cadastro atualizado.' : 'Cadastro salvo.');
      await loadData();
    }
  }


  async function archiveCheck(record, archive = true) {
    const action = archive ? 'arquivar' : 'restaurar';
    if (!window.confirm((archive ? 'Arquivar' : 'Restaurar') + ' o cheque ' + (record.check_number || 'sem número') + '? O histórico será preservado.')) return;
    setError(''); setNotice(''); setDeletingCheckId(record.id);
    const { error: archiveError } = await supabase.rpc('sany_cheques_archive_check', { p_check_id: record.id, p_archive: archive });
    setDeletingCheckId(null);
    if (archiveError) { setError('Não foi possível ' + action + ' o cheque: ' + archiveError.message); return; }
    setNotice(archive ? 'Cheque arquivado. O histórico foi preservado.' : 'Cheque restaurado para a listagem.');
    await loadData();
  }

  async function deleteCheck(record) {
    const confirmed = window.confirm(
      'Excluir definitivamente o cheque ' + (record.check_number || 'sem número') + ' (' + money(record.amount) + ')?\\n\\nEsta ação não pode ser desfeita. Cheques vinculados a lotes de pagamento não podem ser excluídos por aqui.'
    );
    if (!confirmed) return;
    setError('');
    setNotice('');
    setDeletingCheckId(record.id);

    const { data: batchItems, error: batchItemsError } = await supabase
      .from('sany_cheques_payment_batch_items')
      .select('id')
      .eq('check_id', record.id)
      .limit(1);
    if (batchItemsError) {
      setDeletingCheckId(null);
      setError('Não foi possível verificar se este cheque está vinculado a um lote: ' + batchItemsError.message);
      return;
    }
    if (batchItems?.length) {
      setDeletingCheckId(null);
      setError('Este cheque faz parte de um lote de pagamento. Para preservar o histórico, exclua ou corrija o lote primeiro.');
      return;
    }

    const { error: deleteError } = await supabase.rpc('sany_cheques_delete_check', {
      p_check_id: record.id,
    });
    setDeletingCheckId(null);
    if (deleteError) {
      setError('Não foi possível excluir o cheque. Detalhe: ' + deleteError.message);
      return;
    }
    if (historyCheck?.id === record.id) setHistoryCheck(null);
    setSelectedCheckIds((old) => old.filter((id) => id !== record.id));
    setPaymentSelectedIds((old) => old.filter((id) => id !== record.id));
    setNotice('Cheque excluído.');
    await loadData();
  }

  async function markReturned(record) {
    const confirmed = window.confirm('Marcar o cheque ' + (record.check_number || 'sem número') + ' como DEVOLVIDO? Ele ficará destacado em vermelho.');
    if (!confirmed) return;
    setError('');
    setNotice('');
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updateError } = await supabase.from('sany_cheques_records').update({
      status: 'devolvido',
      returned_date: record.returned_date || today(),
      updated_at: new Date().toISOString(),
      updated_by: user?.id || null,
    }).eq('id', record.id);
    if (updateError) { setError(updateError.message); return; }
    setNotice('Cheque marcado como devolvido e destacado em vermelho.');
    await loadData();
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

  function printReport() {
    window.print();
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
          ['pagamentos', 'Montar pagamento'],
          ['ordens', 'Ordens de pagamento'],
          ['arquivados', 'Cheques arquivados'],
          ['relatorios', 'Relatórios'],
          ['cadastros', 'Clientes e fornecedores'],
        ].map(([key, label]) => <button key={key} className={'nav ' + (page === key ? 'active' : '')} onClick={() => { setPage(key); setError(''); }}>{label}</button>)}
        <a className="nav" href="/">← Voltar ao SANY CONTAS</a>
        <button className="logout" onClick={logout}>Sair</button>
      </aside>

      <main className="main">
        <header>
          <h1>{page === 'painel' ? 'Visão geral' : page === 'cheques' ? 'Controle de cheques' : page === 'relatorios' ? 'Relatórios' : page === 'pagamentos' ? 'Montar pagamento' : page === 'ordens' ? 'Ordens de pagamento' : 'Clientes e fornecedores'}</h1>
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
            <MetricButton label="Compensados" value={activeRecords.filter((r) => r.status === 'compensado_confirmado').length + ' · ' + money(records.filter((r) => r.status === 'compensado_confirmado').reduce((sum, r) => sum + Number(r.amount || 0), 0))} onClick={() => { setPage('cheques'); setFilters({ ...filters, status: 'compensado_confirmado' }); setSearch(''); }} />
          </div>
          <Card title="Cheques próximos do vencimento ou vencidos" actions={<button className="primary" onClick={openNewCheck}>+ Cadastrar cheque</button>}>
            <CheckTable rows={activeRecords.filter((r) => r.status !== 'cancelado').slice().sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31')).slice(0, 12)} partyNames={partyNames} onEdit={openEditCheck} onHistory={openHistory} onReturn={markReturned} onDelete={deleteCheck} onArchive={archiveCheck} deletingCheckId={deletingCheckId} />
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
              <label>Fornecedor/destino<select value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}><option value="">Todos os fornecedores/destinos</option>{suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}{[...new Set(paymentBatches.map((b) => (b.destination || "").trim()).filter(Boolean))].filter((name) => !suppliers.some((p) => p.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))).map((name) => <option key={"destination:" + name} value={"destination:" + name}>{name} (ordem)</option>)}</select></label>
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
          <Card title="Relação de cheques"><CheckTable rows={filteredRecords} partyNames={partyNames} onEdit={openEditCheck} onHistory={openHistory} onDelete={deleteCheck} onArchive={archiveCheck} deletingCheckId={deletingCheckId} selectable selectedIds={selectedCheckIds} onToggleSelect={(id, checked) => setSelectedCheckIds((old) => checked ? [...new Set([...old, id])] : old.filter((x) => x !== id))} onToggleAll={(checked) => setSelectedCheckIds((old) => checked ? [...new Set([...old, ...filteredRecords.filter((r) => r.status === 'em_carteira').map((r) => r.id)])] : old.filter((id) => !filteredRecords.some((r) => r.id === id)))} /></Card>
        </>}

        {page === 'relatorios' && <>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="cardhead"><h2>Relatório por cliente, fornecedor e vencimento</h2><div className="rowactions"><button className="secondary" onClick={exportCsv}>Exportar CSV/Excel</button><button className="primary" onClick={printReport}>Imprimir relatório</button></div></div>
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
          <Card title="Resultado do relatório"><CheckTable rows={filteredRecords} partyNames={partyNames} onEdit={openEditCheck} onHistory={openHistory} onReturn={markReturned} onDelete={deleteCheck} onArchive={archiveCheck} deletingCheckId={deletingCheckId} /></Card>
        </>}

        {page === 'pagamentos' && <>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="cardhead"><h2>Selecione os cheques para compor o pagamento</h2><div className="rowactions"><button className="secondary" onClick={() => setPaymentSelectedIds(paymentEligible.map((r) => r.id))}>Selecionar todos elegíveis</button><button className="secondary" onClick={() => setPaymentSelectedIds([])}>Limpar seleção</button></div></div>
            <p className="muted">Somente cheques recebidos que ainda estão em carteira podem entrar em um novo lote. Cheques repassados, compensados, devolvidos ou cancelados ficam fora para evitar reutilização indevida.</p>
            <div className="grid sany-cheques-summary"><Metric label="Selecionados" value={paymentSelected.length} /><Metric label="Total do pagamento" value={money(paymentTotal)} /><Metric label="Vencimento médio" value={(() => { const ds = paymentSelected.map((r) => r.due_date).filter(Boolean).map((d) => new Date(d + 'T00:00:00').getTime()); return ds.length ? new Date(ds.reduce((a,b) => a+b,0)/ds.length).toLocaleDateString('pt-BR') : '—'; })()} /></div>
            <div className="tablewrap"><table><thead><tr><th>Selecionar</th><th>Bom para</th><th>Número</th><th>Cliente/origem</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{paymentEligible.length ? paymentEligible.map((r) => <tr key={r.id} className={r.status === "devolvido" ? "sany-cheque-returned" : ""}><td><input type="checkbox" aria-label={'Selecionar cheque ' + (r.check_number || '')} checked={paymentSelectedIds.includes(r.id)} onChange={(e) => setPaymentSelectedIds((old) => e.target.checked ? [...new Set([...old, r.id])] : old.filter((id) => id !== r.id))} /></td><td>{date(r.due_date)}</td><td>{r.check_number || '—'}</td><td>{partyNames.get(r.origin_client_id) || r.issuer_name || '—'}</td><td><strong>{money(r.amount)}</strong></td><td>{statusLabels[r.effective_status] || r.effective_status}</td></tr>) : <tr><td colSpan="6">Nenhum cheque recebido em carteira disponível para seleção.</td></tr>}</tbody></table></div>
          </div>
          <div className="card"><div className="cardhead"><h2>Registrar ordem de pagamento</h2></div><form className="form" onSubmit={savePaymentBatch}><label>Fornecedor/destino<input value={paymentDestination} onChange={(e) => setPaymentDestination(e.target.value)} placeholder="Ex.: Fornecedor A" required /></label><label>Valor total da obrigação (R$)<input type="number" min="0.01" step="0.01" value={paymentInvoiceTotal} onChange={(e) => setPaymentInvoiceTotal(e.target.value)} placeholder="Ex.: 5000,00" required /></label><label className="wide">Observação (opcional)<input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Referência da compra ou pagamento" /></label><div className="wide"><h3>Outras formas de pagamento e abatimentos</h3><p className="muted">O total da obrigação deve ser igual aos cheques selecionados + pagamentos adicionais + abatimentos. Devoluções/abatimentos são registrados separadamente.</p>{paymentMethods.map((m) => <div className="form" key={m.id} style={{ border: '1px solid var(--border, #ddd)', borderRadius: 10, padding: 12, marginBottom: 10, gridTemplateColumns: '1fr 1fr 1fr auto' }}><label>Tipo<select value={m.line_type} onChange={(e) => setPaymentMethods((old) => old.map((x) => x.id === m.id ? { ...x, line_type: e.target.value, method: e.target.value === 'abatement' ? 'Devolução / abatimento' : 'PIX' } : x))}><option value="payment">Pagamento</option><option value="abatement">Devolução / abatimento</option></select></label><label>Forma<select value={m.method} onChange={(e) => setPaymentMethods((old) => old.map((x) => x.id === m.id ? { ...x, method: e.target.value } : x))}>{(m.line_type === 'abatement' ? ['Devolução / abatimento', 'Desconto', 'Crédito do fornecedor'] : ['PIX', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Transferência bancária', 'Boleto', 'Outro']).map((method) => <option key={method} value={method}>{method}</option>)}</select></label><label>Valor (R$)<input type="number" min="0.01" step="0.01" value={m.amount} onChange={(e) => setPaymentMethods((old) => old.map((x) => x.id === m.id ? { ...x, amount: e.target.value } : x))} placeholder="0,00" /></label><button type="button" className="secondary" onClick={() => setPaymentMethods((old) => old.filter((x) => x.id !== m.id))}>Remover</button><label className="wide">Referência / motivo (opcional)<input value={m.reference} onChange={(e) => setPaymentMethods((old) => old.map((x) => x.id === m.id ? { ...x, reference: e.target.value } : x))} placeholder={m.line_type === 'abatement' ? 'Ex.: mercadoria devolvida' : 'Ex.: comprovante PIX'} /></label></div>)}<button type="button" className="secondary" onClick={() => { setPaymentMethods((old) => [...old, { id: paymentMethodNextId, line_type: 'payment', method: 'PIX', amount: '', reference: '' }]); setPaymentMethodNextId((n) => n + 1); }}>+ Adicionar forma / abatimento</button><div className="grid sany-cheques-summary" style={{ marginTop: 12 }}><Metric label="Cheques selecionados" value={money(paymentTotal)} /><Metric label="Pagamentos e abatimentos" value={money(paymentMethods.reduce((sum, m) => sum + (Number(m.amount) || 0), 0))} /><Metric label="Diferença" value={money(Number(paymentInvoiceTotal || 0) - paymentTotal - paymentMethods.reduce((sum, m) => sum + (Number(m.amount) || 0), 0))} /></div></div><button className="primary" type="submit" disabled={paymentSaving}>{paymentSaving ? 'Registrando…' : 'Registrar ordem de pagamento'}</button><p className="muted">Os cheques selecionados passam para “Repassado”. Pagamentos adicionais e abatimentos ficam registrados na ordem. Ordens só com PIX, dinheiro ou outras formas também são permitidas.</p></form></div>
          <Card title="Ordens de pagamento"><div className="tablewrap"><table><thead><tr><th>Data</th><th>Destino</th><th>Cheques</th><th>Total registrado</th><th>Observação</th><th>Detalhes</th></tr></thead><tbody>{paymentBatches.length ? paymentBatches.map((b) => <tr key={b.id}><td>{new Date(b.created_at).toLocaleDateString('pt-BR')}</td><td>{b.destination}</td><td>{b.check_count}</td><td><strong>{money(b.total_amount)}</strong></td><td>{b.notes || '—'}</td><td><div className="rowactions"><button className="secondary" onClick={() => openPaymentBatch(b)}>Ver cheques</button><button className="secondary small" disabled={deletingBatchId === b.id} onClick={() => deletePaymentBatch(b)}>{deletingBatchId === b.id ? 'Excluindo…' : 'Excluir ordem'}</button></div></td></tr>) : <tr><td colSpan="6">Nenhum lote registrado ainda.</td></tr>}</tbody></table></div></Card>
        </>}

        {page === 'ordens' && <>
          <Card title="Ordens de pagamento">
            <div className="tablewrap"><table><thead><tr><th>Data</th><th>Destino</th><th>Cheques</th><th>Total</th><th>Observação</th><th>Ações</th></tr></thead><tbody>{paymentBatches.length ? paymentBatches.map((b) => <tr key={b.id}><td>{new Date(b.created_at).toLocaleDateString('pt-BR')}</td><td>{b.destination}</td><td>{b.check_count}</td><td><strong>{money(b.total_amount)}</strong></td><td>{b.notes || '—'}</td><td><div className="rowactions"><button className="secondary" onClick={() => openPaymentBatch(b)}>Ver cheques</button><button className="secondary small" disabled={deletingBatchId === b.id} onClick={() => deletePaymentBatch(b)}>{deletingBatchId === b.id ? 'Excluindo…' : 'Excluir ordem'}</button></div></td></tr>) : <tr><td colSpan="6">Nenhuma ordem de pagamento registrada ainda.</td></tr>}</tbody></table></div>
          </Card>
        </>}
        {page === 'arquivados' && <>
          <Card title="Cheques arquivados">
            <p className="muted">Os cheques arquivados ficam fora dos indicadores e das listas normais, mas seu histórico continua preservado. Você pode restaurá-los quando precisar.</p>
            <CheckTable rows={records.filter((r) => r.archived_at)} partyNames={partyNames} onEdit={openEditCheck} onHistory={openHistory} onArchive={archiveCheck} deletingCheckId={deletingCheckId} archivedView />
          </Card>
        </>}
        {page === 'cadastros' && <>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="cardhead"><h2>Novo cliente ou fornecedor</h2></div>
            <form className="form" onSubmit={saveParty}>
              <label>Tipo<select value={partyForm.party_type} onChange={(e) => setPartyForm({ ...partyForm, party_type: e.target.value })}><option value="cliente">Cliente</option><option value="fornecedor">Fornecedor</option><option value="outro">Outro</option></select></label>
              <label>Nome da empresa<input value={partyForm.name} onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })} required /></label>
              {partyForm.party_type === 'cliente' && <>
                <label>Grupo principal existente<select value={partyForm.customer_group_id} onChange={(e) => setPartyForm({ ...partyForm, customer_group_id: e.target.value, new_customer_group_name: '' })}><option value="">Sem grupo / criar novo abaixo</option>{customerGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
                <label>Novo grupo (opcional)<input value={partyForm.new_customer_group_name} onChange={(e) => setPartyForm({ ...partyForm, new_customer_group_name: e.target.value, customer_group_id: '' })} placeholder="Ex.: Grupo Netto" /></label>
                <p className="muted wide">Para cadastrar duas empresas no mesmo grupo: crie a primeira com o nome do grupo e, ao cadastrar a segunda, selecione esse grupo existente.</p>
              </>}
              <label>CNPJ/CPF (opcional)<input value={partyForm.document} onChange={(e) => setPartyForm({ ...partyForm, document: e.target.value })} /></label>
              <label>Telefone (opcional)<input value={partyForm.phone} onChange={(e) => setPartyForm({ ...partyForm, phone: e.target.value })} /></label>
              <label className="wide">Observações<textarea value={partyForm.notes} onChange={(e) => setPartyForm({ ...partyForm, notes: e.target.value })} /></label>
              <button className="primary" type="submit">Salvar cadastro</button>
            </form>
          </div>
          <Card title="Clientes cadastrados"><PartyTable rows={clients} groupNames={customerGroupNames} onEdit={openEditParty} /></Card>
          <Card title="Fornecedores cadastrados"><PartyTable rows={suppliers} groupNames={customerGroupNames} onEdit={openEditParty} /></Card>
        </>}
        {loading && <div className="loading">Atualizando dados…</div>}
      </main>

      {editingParty && <div className="modalbackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setEditingParty(null); setPartyForm(blankParty()); } }}>
        <section className="modal sany-cheques-modal">
          <div className="modalhead"><h2>Editar cliente ou fornecedor</h2><button className="iconbutton" onClick={() => { setEditingParty(null); setPartyForm(blankParty()); }}>×</button></div>
          <form className="customerform" onSubmit={saveParty}>
            <label>Tipo<select value={partyForm.party_type} onChange={(e) => setPartyForm({ ...partyForm, party_type: e.target.value })}><option value="cliente">Cliente</option><option value="fornecedor">Fornecedor</option><option value="outro">Outro</option></select></label>
            <label>Nome da empresa<input value={partyForm.name} onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })} required /></label>
            {partyForm.party_type === 'cliente' && <>
                <label>Grupo principal existente<select value={partyForm.customer_group_id} onChange={(e) => setPartyForm({ ...partyForm, customer_group_id: e.target.value, new_customer_group_name: '' })}><option value="">Sem grupo / criar novo abaixo</option>{customerGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
                <label>Novo grupo (opcional)<input value={partyForm.new_customer_group_name} onChange={(e) => setPartyForm({ ...partyForm, new_customer_group_name: e.target.value, customer_group_id: '' })} placeholder="Ex.: Grupo Netto" /></label>
                <p className="muted wide">Para cadastrar duas empresas no mesmo grupo: crie a primeira com o nome do grupo e, ao cadastrar a segunda, selecione esse grupo existente.</p>
              </>}
            <label>CNPJ/CPF (opcional)<input value={partyForm.document} onChange={(e) => setPartyForm({ ...partyForm, document: e.target.value })} /></label>
            <label>Telefone (opcional)<input value={partyForm.phone} onChange={(e) => setPartyForm({ ...partyForm, phone: e.target.value })} /></label>
            <label className="wide">Observações<textarea value={partyForm.notes} onChange={(e) => setPartyForm({ ...partyForm, notes: e.target.value })} /></label>
            <div className="modalactions wide"><button type="button" className="secondary" onClick={() => { setEditingParty(null); setPartyForm(blankParty()); }}>Cancelar</button><button type="submit" className="primary">Salvar alterações</button></div>
          </form>
        </section>
      </div>}
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
      {paymentBatchDetails && <div className="modalbackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPaymentBatchDetails(null); }}>
        <section className="modal sany-cheques-modal sany-cheques-print-receipt">
          <div className="modalhead"><div><h2>Detalhes da ordem de pagamento</h2><small className="muted">{paymentBatchDetails.batch.destination} · {new Date(paymentBatchDetails.batch.created_at).toLocaleString('pt-BR')}</small></div><button className="iconbutton" onClick={() => setPaymentBatchDetails(null)}>×</button></div>
          <div className="sany-cheques-print-heading"><h1>SANY EMBALAGENS</h1><h2>RELAÇÃO DE CHEQUES — ORDEM DE PAGAMENTO</h2><p>Fornecedor/destino: <strong>{paymentBatchDetails.batch.destination}</strong></p><p>Data da ordem: {new Date(paymentBatchDetails.batch.created_at).toLocaleDateString('pt-BR')}</p></div><div className="sany-cheques-bulk-summary"><strong>{paymentBatchDetails.batch.check_count} cheque(s)</strong><span>Total da obrigação: {money(paymentBatchDetails.batch.invoice_total_amount ?? paymentBatchDetails.batch.total_amount)}</span><span>Total em cheques: {money(paymentBatchDetails.batch.cheque_total_amount ?? paymentBatchDetails.batch.total_amount)}</span><span>Destino: {paymentBatchDetails.batch.destination}</span>{paymentBatchDetails.batch.notes && <span>Obs.: {paymentBatchDetails.batch.notes}</span>}</div>{paymentBatchDetails.methods?.length > 0 && <div className="tablewrap" style={{ marginTop: 12 }}><table><thead><tr><th>Tipo</th><th>Forma</th><th>Valor</th><th>Referência / motivo</th></tr></thead><tbody>{paymentBatchDetails.methods.map((m) => <tr key={m.id}><td>{m.line_type === 'abatement' ? 'Abatimento / devolução' : 'Pagamento'}</td><td>{m.method}</td><td><strong>{money(m.amount)}</strong></td><td>{m.reference || '—'}</td></tr>)}</tbody></table></div>}
          {paymentBatchDetailLoading ? <p>Carregando cheques do lote…</p> : <div className="tablewrap"><table><thead><tr><th>Número</th><th>Banco</th><th>Valor no lote</th><th>Bom para</th><th>Situação atual</th><th>Local atual</th></tr></thead><tbody>{paymentBatchDetails.items.length ? paymentBatchDetails.items.map((item) => <tr key={item.id}><td><strong>{item.check?.check_number || 'Número não informado'}</strong></td><td>{item.check?.bank_name || '—'}</td><td>{money(item.amount_snapshot)}</td><td>{date(item.due_date_snapshot)}</td><td>{item.check ? (statusLabels[item.check.effective_status] || item.check.effective_status) : 'Cheque não encontrado'}</td><td>{item.check?.current_holder || paymentBatchDetails.batch.destination}</td></tr>) : <tr><td colSpan="6">Esta ordem não possui cheques registrados.</td></tr>}</tbody></table></div>}
          <div className="sany-cheques-print-signatures"><div>____________________________________<br />SANY EMBALAGENS</div><div>Recebido por: __________________________<br />Assinatura do fornecedor</div></div><div className="modalactions"><button className="secondary" onClick={() => setPaymentBatchDetails(null)}>Fechar</button><button className="secondary" onClick={() => window.print()}>Imprimir relação para fornecedor</button><button className="secondary" disabled={deletingBatchId === paymentBatchDetails.batch.id} onClick={() => deletePaymentBatch(paymentBatchDetails.batch)}>{deletingBatchId === paymentBatchDetails.batch.id ? 'Excluindo…' : 'Excluir lote'}</button></div>
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
function CheckTable({ rows, partyNames, onEdit, onHistory, onReturn, onDelete, onArchive, deletingCheckId, archivedView = false, selectable = false, selectedIds = [], onToggleSelect, onToggleAll }) {
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
      <td><div className="rowactions"><button className="secondary small" onClick={() => onEdit(r)}>Editar</button><button className="secondary small" onClick={() => onHistory(r)}>Histórico</button>{archivedView ? <button className="secondary small" disabled={deletingCheckId === r.id} onClick={() => onArchive?.(r, false)}>{deletingCheckId === r.id ? 'Restaurando…' : 'Restaurar'}</button> : <>{r.status !== 'devolvido' && <button className="secondary small" onClick={() => onReturn?.(r)}>Marcar devolvido</button>}<button type="button" className="secondary small" disabled={deletingCheckId === r.id} onClick={() => onArchive?.(r, true)}>{deletingCheckId === r.id ? 'Arquivando…' : 'Arquivar'}</button><button type="button" className="secondary small danger" disabled={deletingCheckId === r.id} onClick={() => { if (onDelete) Promise.resolve(onDelete(r)).catch((err) => window.alert("Erro ao excluir cheque: " + (err?.message || "falha inesperada"))); }}>{deletingCheckId === r.id ? 'Excluindo…' : 'Excluir'}</button></>}</div></td>
    </tr>) : <tr><td colSpan={selectable ? 9 : 8} className="empty">Nenhum cheque encontrado para esses filtros.</td></tr>}
  </tbody></table></div>;
}
function PartyTable({ rows, groupNames, onEdit }) {
  return <div className="tablewrap"><table><thead><tr><th>Nome da empresa</th><th>Grupo principal</th><th>Documento</th><th>Telefone</th><th>Observações</th><th>Ações</th></tr></thead><tbody>
    {rows.length ? rows.map((p) => <tr key={p.id}><td><strong>{p.name}</strong></td><td>{groupNames?.get(p.customer_group_id) || p.customer_group_name || '—'}</td><td>{p.document || '—'}</td><td>{p.phone || '—'}</td><td>{p.notes || '—'}</td><td><button className="secondary small" onClick={() => onEdit(p)}>Editar</button></td></tr>) : <tr><td colSpan="6" className="empty">Nenhum cadastro nesta categoria.</td></tr>}
  </tbody></table></div>;
}
