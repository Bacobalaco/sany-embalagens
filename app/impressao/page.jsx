'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import './print.css';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const moneyNumber = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateBR = (v) => v ? new Date(v + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const methodLabel = (v) => ({ credit:'CONTA', pix:'PIX', cash:'DINHEIRO', card:'CARTÃO', check:'CHEQUE', transfer:'TRANSFERÊNCIA', return:'DEVOLUÇÃO/TROCA' })[v] || '—';

const getNetwork = (storeName) => storeName ? storeName.split(' • ')[0].trim() : '';
const getBranch = (customer) => customer?.store_name?.split(' • ')[1]?.trim() || customer?.name || '';

export default function ImpressaoPage() {
  const [session, setSession] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewMode, setViewMode] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const [{ data: c, error: ce }, { data: t, error: te }] = await Promise.all([
        supabase.from('customers').select('id,name,store_name,active').eq('active', true).order('name'),
        supabase.from('customer_transactions').select('id,customer_id,type,amount,payment_method,transaction_date,description,status').order('transaction_date', { ascending: true }).limit(5000),
      ]);
      if (ce || te) setError((ce || te)?.message || 'Não foi possível carregar os dados.');
      setCustomers(c || []);
      setTransactions((t || []).filter(x => x.status === 'posted'));
    })();
  }, [session]);

  const networks = useMemo(() => {
    const map = new Map();
    customers.forEach(c => {
      const network = getNetwork(c.store_name);
      if (!network) return;
      if (!map.has(network)) map.set(network, []);
      map.get(network).push(c);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [customers]);

  const isNetworkSelection = customerId.startsWith('group:');
  const selectedNetwork = isNetworkSelection ? customerId.slice(6) : '';
  const selectedCustomer = customers.find(c => c.id === customerId) || null;
  const selectedCustomers = useMemo(() => {
    if (isNetworkSelection) return networks.find(([name]) => name === selectedNetwork)?.[1] || [];
    return selectedCustomer ? [selectedCustomer] : [];
  }, [isNetworkSelection, selectedNetwork, networks, selectedCustomer]);
  const customerIds = useMemo(() => new Set(selectedCustomers.map(c => c.id)), [selectedCustomers]);
  const displayName = isNetworkSelection ? `${selectedNetwork.toUpperCase()} — REDE COMPLETA` : (selectedCustomer?.name || 'CLIENTE');

  const rows = useMemo(() => transactions
    .filter(x => customerIds.has(x.customer_id))
    .filter(x => !from || x.transaction_date >= from)
    .filter(x => !to || x.transaction_date <= to)
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)), [transactions, customerIds, from, to]);

  const purchases = rows.filter(x => x.type === 'sale');
  const payments = rows.filter(x => ['payment', 'credit'].includes(x.type));
  const totalPurchases = purchases.reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalPayments = payments.reduce((s, x) => s + Number(x.amount || 0), 0);
  const balance = totalPurchases - totalPayments;

  const paymentByMethod = useMemo(() => {
    const map = new Map();
    payments.forEach(x => {
      const key = x.payment_method || 'other';
      map.set(key, (map.get(key) || 0) + Number(x.amount || 0));
    });
    return Array.from(map.entries());
  }, [payments]);

  const printDate = to || from || new Date().toISOString().slice(0, 10);

  function printReceipt() {
    if (!selectedCustomers.length) {
      setError('Selecione um cliente ou uma rede antes de imprimir.');
      return;
    }
    window.print();
  }

  if (!session) return (
    <main className="login-print">
      <div className="print-panel">
        <div className="brand">SANY <span>Embalagens</span></div>
        <p>Faça login no sistema para acessar a impressão.</p>
        <a href="/">Voltar ao sistema</a>
      </div>
    </main>
  );

  return (
    <main className="print-page">
      <section className="print-controls no-print">
        <div className="controls-head">
          <div><h1>Imprimir conta</h1><p>Confira a via e imprima em 80 mm.</p></div>
          <div className="printer-icon">🖨️</div>
        </div>
        <div className="controls-grid">
          <label>Cliente / Rede<select value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">Selecione o cliente ou a rede</option>
            {networks.map(([network, members]) => (
              <optgroup key={network} label={network.toUpperCase()}>
                <option value={`group:${network}`}>★ {network} — REDE COMPLETA ({members.length} clientes)</option>
                {members.map(c => <option key={c.id} value={c.id}>{getBranch(c)} — {c.name}</option>)}
              </optgroup>
            ))}
            <optgroup label="CLIENTES SEM REDE">
              {customers.filter(c => !getNetwork(c.store_name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          </select></label>
          <label>De<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>Até<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
          <label>Mostrar<select value={viewMode} onChange={e => setViewMode(e.target.value)}>
            <option value="all">Compras e pagamentos</option>
            <option value="purchases">Somente compras</option>
            <option value="payments">Somente pagamentos</option>
          </select></label>
        </div>
        <div className="control-actions">
          <button className="secondary" onClick={() => window.location.href = '/'}>Voltar</button>
          <button className="primary print-button" onClick={printReceipt}>🖨️ Imprimir via do cliente</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="receipt">
        <div className="receipt-date">{dateBR(printDate)}</div>
        <div className="receipt-title">{displayName}</div>

        {(viewMode === 'all' || viewMode === 'purchases') && (
          <div className="receipt-section purchase-section">
            <div className="receipt-row receipt-head"><strong>DEVE</strong><span>R$</span><strong>VALOR</strong></div>
            {purchases.map(x => {
              const customerForRow = customers.find(c => c.id === x.customer_id);
              const branch = isNetworkSelection ? getBranch(customerForRow) : '';
              return (
                <div className="receipt-row data-row" key={x.id}>
                  <span>{`${branch ? branch + ' • ' : ''}${(x.description || 'COMPRA').toUpperCase()}`}</span><span>R$</span><strong>{moneyNumber(x.amount)}</strong>
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, 8 - purchases.length) }).map((_, i) => (
              <div className="receipt-row blank-row" key={`blank-${i}`}><span></span><span></span><span></span></div>
            ))}
            <div className="receipt-total"><span>R$</span><strong>{moneyNumber(totalPurchases)}</strong></div>
          </div>
        )}

        {viewMode === 'all' && (
          <div className="receipt-summary">
            <div className="summary-row paid-row"><strong>PAGOU</strong><strong>{moneyNumber(totalPayments)}</strong></div>
            <div className="summary-row balance-row"><strong>DEVE</strong><span><b>R$</b><strong>{moneyNumber(balance)}</strong></span></div>
          </div>
        )}

        {(viewMode === 'all' || viewMode === 'payments') && (
          <div className="payment-section">
            {paymentByMethod.map(([method, amount]) => (
              <div className="payment-row" key={method}><strong>{methodLabel(method)}</strong><span>R$</span><strong>{moneyNumber(amount)}</strong></div>
            ))}
            {paymentByMethod.length === 0 && <div className="payment-row"><strong></strong><span>R$</span><strong>0,00</strong></div>}
            <div className="payment-total"><span>R$</span><strong>{moneyNumber(totalPayments)}</strong></div>
          </div>
        )}

        {viewMode === 'purchases' && (
          <div className="receipt-summary purchases-only-summary">
            <div className="summary-row balance-row"><strong>TOTAL COMPRAS</strong><span><b>R$</b><strong>{moneyNumber(totalPurchases)}</strong></span></div>
          </div>
        )}

        {viewMode === 'payments' && (
          <div className="receipt-summary payments-only-summary">
            <div className="summary-row balance-row"><strong>TOTAL PAGO</strong><span><b>R$</b><strong>{moneyNumber(totalPayments)}</strong></span></div>
          </div>
        )}

        <div className="receipt-footer">SANY EMBALAGENS</div>
      </section>
    </main>
  );
}
