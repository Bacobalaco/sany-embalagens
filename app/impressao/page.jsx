'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import './print.css';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const moneyNumber = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateBR = (v) => v ? new Date(v + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const methodLabel = (v) => ({ credit:'CONTA', pix:'PIX', cash:'DINHEIRO', card:'CARTÃO', check:'CHEQUE', transfer:'TRANSFERÊNCIA' })[v] || '—';

export default function ImpressaoPage() {
  const [session, setSession] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
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

  const customer = customers.find(c => c.id === customerId) || null;
  const rows = useMemo(() => transactions
    .filter(x => x.customer_id === customerId)
    .filter(x => !from || x.transaction_date >= from)
    .filter(x => !to || x.transaction_date <= to)
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)), [transactions, customerId, from, to]);

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
    if (!customer) {
      setError('Selecione um cliente antes de imprimir.');
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
          <label>Cliente<select value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">Selecione o cliente</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.store_name ? ` — ${c.store_name}` : ''}</option>)}
          </select></label>
          <label>De<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>Até<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>
        <div className="control-actions">
          <button className="secondary" onClick={() => window.location.href = '/'}>Voltar</button>
          <button className="primary print-button" onClick={printReceipt}>🖨️ Imprimir via do cliente</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="receipt">
        <div className="receipt-date">{dateBR(printDate)}</div>
        <div className="receipt-title">{customer?.name || 'CLIENTE'}</div>

        <div className="receipt-section purchase-section">
          <div className="receipt-row receipt-head"><strong>DEVE</strong><span>R$</span><strong>VALOR</strong></div>
          {purchases.map(x => (
            <div className="receipt-row data-row" key={x.id}>
              <span>{(x.description || 'COMPRA').toUpperCase()}</span><span>R$</span><strong>{moneyNumber(x.amount)}</strong>
            </div>
          ))}
          {Array.from({ length: Math.max(0, 8 - purchases.length) }).map((_, i) => (
            <div className="receipt-row blank-row" key={`blank-${i}`}><span></span><span></span><span></span></div>
          ))}
          <div className="receipt-total"><span>R$</span><strong>{moneyNumber(totalPurchases)}</strong></div>
        </div>

        <div className="receipt-summary">
          <div className="summary-row paid-row"><strong>PAGOU</strong><strong>{moneyNumber(totalPayments)}</strong></div>
          <div className="summary-row balance-row"><strong>DEVE</strong><span><b>R$</b><strong>{moneyNumber(balance)}</strong></span></div>
        </div>

        <div className="payment-section">
          {paymentByMethod.map(([method, amount]) => (
            <div className="payment-row" key={method}><strong>{methodLabel(method)}</strong><span>R$</span><strong>{moneyNumber(amount)}</strong></div>
          ))}
          {paymentByMethod.length === 0 && <div className="payment-row"><strong></strong><span>R$</span><strong>0,00</strong></div>}
          <div className="payment-total"><span>R$</span><strong>{moneyNumber(totalPayments)}</strong></div>
        </div>

        <div className="receipt-footer">SANY EMBALAGENS</div>
      </section>
    </main>
  );
}
