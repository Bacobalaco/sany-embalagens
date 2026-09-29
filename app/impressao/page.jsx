'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const money = (v) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(v || 0));

const dateBR = (v) =>
  v ? new Date(v + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

const typeLabel = (v) => ({ sale: 'COMPRA', payment: 'PAGOU', credit: 'CRÉDITO' })[v] || v;
const methodLabel = (v) =>
  ({ credit: 'CONTA', pix: 'PIX', cash: 'DINHEIRO', card: 'CARTÃO', check: 'CHEQUE', transfer: 'TRANSFERÊNCIA' })[v] || '—';

export default function ImpressaoPage() {
  const [session, setSession] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      setLoading(true);
      const [{ data: c, error: ce }, { data: t, error: te }] = await Promise.all([
        supabase
          .from('customers')
          .select('id,name,store_name,active')
          .eq('active', true)
          .order('name'),
        supabase
          .from('customer_transactions')
          .select('id,customer_id,type,amount,payment_method,transaction_date,description,status')
          .order('transaction_date', { ascending: true })
          .limit(5000),
      ]);
      if (ce || te) setError((ce || te)?.message || 'Não foi possível carregar os dados.');
      setCustomers(c || []);
      setTransactions((t || []).filter((x) => x.status === 'posted'));
      setLoading(false);
    })();
  }, [session]);

  const customer = customers.find((c) => c.id === customerId) || null;

  const rows = useMemo(() => {
    return transactions
      .filter((x) => x.customer_id === customerId)
      .filter((x) => !from || x.transaction_date >= from)
      .filter((x) => !to || x.transaction_date <= to)
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
  }, [transactions, customerId, from, to]);

  const purchases = rows.filter((x) => x.type === 'sale');
  const payments = rows.filter((x) => ['payment', 'credit'].includes(x.type));
  const totalPurchases = purchases.reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalPayments = payments.reduce((s, x) => s + Number(x.amount || 0), 0);
  const balance = totalPurchases - totalPayments;

  const paymentByMethod = useMemo(() => {
    const map = new Map();
    payments.forEach((x) => {
      const key = x.payment_method || 'other';
      map.set(key, (map.get(key) || 0) + Number(x.amount || 0));
    });
    return Array.from(map.entries());
  }, [payments]);

  function printReceipt() {
    if (!customer) {
      setError('Selecione um cliente antes de imprimir.');
      return;
    }
    window.print();
  }

  if (!session) {
    return (
      <main className="login-print">
        <div className="print-panel">
          <h1>SANY Embalagens</h1>
          <p>Faça login no sistema para acessar a impressão.</p>
          <a href="/">Voltar ao sistema</a>
        </div>
      </main>
    );
  }

  return (
    <main className="print-page">
      <section className="print-controls no-print">
        <div>
          <h1>Impressão de conta</h1>
          <p>Selecione o cliente, período e confira o comprovante antes de imprimir.</p>
        </div>
        <div className="controls-grid">
          <label>
            Cliente
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Selecione</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.store_name ? ` — ${c.store_name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Até
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="control-actions">
            <button className="secondary" onClick={() => window.location.href = '/'}>Voltar</button>
            <button className="primary" onClick={printReceipt}>Imprimir</button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="receipt">
        <div className="receipt-date">{to || from || new Date().toISOString().slice(0, 10) ? dateBR(to || from || new Date().toISOString().slice(0, 10)) : ''}</div>
        <div className="receipt-title">{customer?.name || 'CLIENTE'}</div>
        {customer?.store_name && <div className="receipt-store">{customer.store_name}</div>}

        <div className="receipt-table">
          <div className="receipt-row receipt-head">
            <strong>DEVE</strong><span>R$</span><strong>VALOR</strong>
          </div>
          {purchases.length === 0 ? (
            <div className="receipt-row muted-row"><span>Sem compras no período</span><span>—</span><span>—</span></div>
          ) : (
            purchases.map((x) => (
              <div className="receipt-row" key={x.id}>
                <span>{x.description || 'Compra'}</span>
                <span>R$</span>
                <strong>{Number(x.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
              </div>
            ))
          )}
          <div className="receipt-total"><span>R$</span><strong>{money(totalPurchases).replace('R$', '').trim()}</strong></div>
        </div>

        <div className="receipt-summary">
          <div className="summary-row"><strong>PAGOU</strong><strong>{money(totalPayments)}</strong></div>
          <div className="summary-row balance-row"><strong>DEVE</strong><strong>{money(balance)}</strong></div>
        </div>

        {payments.length > 0 && (
          <div className="payment-breakdown">
            {paymentByMethod.map(([method, amount]) => (
              <div className="receipt-row" key={method}>
                <span>{methodLabel(method)}</span>
                <span>R$</span>
                <strong>{Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
              </div>
            ))}
            <div className="payment-total"><span>R$</span><strong>{money(totalPayments).replace('R$', '').trim()}</strong></div>
          </div>
        )}

        <div className="receipt-footer">SANY EMBALAGENS</div>
      </section>
    </main>
  );
}

<style jsx global>{`
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, sans-serif; background: #eef1f5; color: #111; }
  .login-print { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .print-panel { background: #fff; padding: 28px; border-radius: 14px; border: 1px solid #ddd; text-align: center; }
  .print-page { min-height: 100vh; padding: 28px; }
  .print-controls { max-width: 900px; margin: 0 auto 24px; background: #fff; padding: 22px; border-radius: 14px; border: 1px solid #d9dde5; }
  .print-controls h1 { margin: 0 0 5px; }
  .print-controls p { margin: 0 0 18px; color: #667085; }
  .controls-grid { display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 12px; align-items: end; }
  .controls-grid label { display: block; font-size: 13px; font-weight: 700; }
  .controls-grid input, .controls-grid select { width: 100%; margin-top: 6px; padding: 10px; border: 1px solid #d0d5dd; border-radius: 9px; background: #fff; }
  .control-actions { display: flex; gap: 8px; }
  .primary, .secondary { border-radius: 9px; padding: 10px 15px; font-weight: 800; cursor: pointer; }
  .primary { border: 0; background: #101828; color: #fff; }
  .secondary { border: 1px solid #d0d5dd; background: #fff; color: #344054; }
  .error { color: #b42318 !important; font-size: 13px; }
  .receipt { width: 80mm; margin: 0 auto; background: #fff; padding: 8mm 5mm 7mm; font-family: Arial, sans-serif; font-size: 12px; color: #000; }
  .receipt-date { font-size: 18px; font-weight: 800; margin-bottom: 5px; }
  .receipt-title { border: 1px solid #222; background: #eee; text-align: center; font-size: 25px; font-weight: 900; padding: 7px 4px; text-transform: uppercase; }
  .receipt-store { text-align: center; font-size: 10px; font-weight: 700; margin: 4px 0 7px; text-transform: uppercase; }
  .receipt-table { border: 1px solid #222; border-bottom: 0; margin-top: 8px; }
  .receipt-row { display: grid; grid-template-columns: 1fr 25px 72px; min-height: 25px; border-bottom: 1px solid #777; align-items: center; }
  .receipt-row > * { padding: 3px 4px; }
  .receipt-row > :nth-child(2) { border-left: 1px solid #777; border-right: 1px solid #777; height: 100%; display: flex; align-items: center; }
  .receipt-row > :last-child { text-align: right; }
  .receipt-head { min-height: 30px; font-size: 13px; }
  .receipt-total { display: grid; grid-template-columns: 1fr 97px; min-height: 31px; border-bottom: 1px solid #222; font-size: 16px; font-weight: 900; align-items: center; }
  .receipt-total > * { padding: 4px; }
  .receipt-total strong { text-align: right; }
  .receipt-summary { margin-top: 6px; }
  .summary-row { display: grid; grid-template-columns: 1fr auto; font-size: 17px; padding: 2px 0; }
  .balance-row { border: 1px solid #222; padding: 4px; font-size: 18px; }
  .payment-breakdown { margin-top: 12px; border-top: 1px solid #777; }
  .payment-total { display: grid; grid-template-columns: 1fr auto; font-weight: 900; font-size: 15px; padding: 4px; border-bottom: 1px solid #222; }
  .receipt-footer { text-align: center; font-weight: 900; font-size: 10px; margin-top: 10px; }
  .muted-row { color: #777; }
  @media print {
    @page { size: 80mm auto; margin: 0; }
    html, body { width: 80mm; background: #fff; }
    .no-print { display: none !important; }
    .print-page { min-height: 0; padding: 0; }
    .receipt { width: 80mm; margin: 0; padding: 4mm 4mm 6mm; box-shadow: none; }
  }
  @media (max-width: 760px) {
    .controls-grid { grid-template-columns: 1fr; }
    .control-actions { justify-content: flex-end; }
  }
`}</style>
