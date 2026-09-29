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

const methodLabel = (v) =>
  ({
    credit: 'CONTA',
    pix: 'PIX',
    cash: 'DINHEIRO',
    card: 'CARTÃO',
    check: 'CHEQUE',
    transfer: 'TRANSFERÊNCIA',
  })[v] || '—';

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

      if (ce || te) {
        setError((ce || te)?.message || 'Não foi possível carregar os dados.');
      }
      setCustomers(c || []);
      setTransactions((t || []).filter((x) => x.status === 'posted'));
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

  const printDate = to || from || new Date().toISOString().slice(0, 10);

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
          <div className="brand">SANY <span>Embalagens</span></div>
          <p>Faça login no sistema para acessar a impressão.</p>
          <a href="/">Voltar ao sistema</a>
        </div>
      </main>
    );
  }

  return (
    <main className="print-page">
      <section className="print-controls no-print">
        <div className="controls-head">
          <div>
            <h1>Imprimir conta</h1>
            <p>Gere a via de 80 mm para entregar ao cliente.</p>
          </div>
          <div className="printer-icon">🖨️</div>
        </div>

        <div className="controls-grid">
          <label className="customer-field">
            Cliente
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Selecione o cliente</option>
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
        </div>

        <div className="control-actions">
          <button className="secondary" onClick={() => (window.location.href = '/')}>Voltar</button>
          <button className="primary print-button" onClick={printReceipt}>🖨️ Imprimir via do cliente</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="receipt">
        <div className="receipt-date">{dateBR(printDate)}</div>

        <div className="receipt-title">{customer?.name || 'CLIENTE'}</div>

        <div className="receipt-table">
          <div className="receipt-row receipt-head">
            <strong>DEVE</strong>
            <span>R$</span>
            <strong>VALOR</strong>
          </div>

          {purchases.map((x) => (
            <div className="receipt-row" key={x.id}>
              <span>{x.description || 'COMPRA'}</span>
              <span>R$</span>
              <strong>{Number(x.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
            </div>
          ))}

          {Array.from({ length: Math.max(0, 8 - purchases.length) }).map((_, i) => (
            <div className="receipt-row blank-row" key={`blank-${i}`}>
              <span></span><span></span><span></span>
            </div>
          ))}

          <div className="receipt-total">
            <span>R$</span>
            <strong>{totalPurchases.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
          </div>
        </div>

        <div className="receipt-summary">
          <div className="summary-row">
            <strong>PAGOU</strong>
            <strong>{totalPayments.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
          </div>
          <div className="summary-row balance-row">
            <strong>DEVE</strong>
            <span><b>R$</b> <strong>{balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
          </div>
        </div>

        <div className="payment-breakdown">
          {paymentByMethod.map(([method, amount]) => (
            <div className="payment-row" key={method}>
              <strong>{methodLabel(method)}</strong>
              <span>R$</span>
              <strong>{Number(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
            </div>
          ))}
          <div className="payment-total">
            <span>R$</span>
            <strong>{totalPayments.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
          </div>
        </div>

        <div className="receipt-footer">SANY EMBALAGENS</div>
      </section>
    </main>
  );
}

<style jsx global>{`
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #eef1f5; color: #111; }

  .login-print { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .print-panel { background: #fff; padding: 30px; border-radius: 14px; border: 1px solid #ddd; text-align: center; }
  .brand { font-size: 22px; font-weight: 900; color: #f28c18; }
  .brand span { color: #142033; }

  .print-page { min-height: 100vh; padding: 30px; }
  .print-controls { max-width: 900px; margin: 0 auto 28px; background: #fff; padding: 24px; border-radius: 16px; border: 1px solid #d9dde5; box-shadow: 0 8px 30px rgba(16,24,40,.06); }
  .controls-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .controls-head h1 { margin: 0 0 5px; font-size: 25px; }
  .controls-head p { margin: 0; color: #667085; }
  .printer-icon { font-size: 30px; }
  .controls-grid { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 14px; align-items: end; }
  .controls-grid label { display: block; font-size: 13px; font-weight: 800; color: #344054; }
  .controls-grid input, .controls-grid select { width: 100%; margin-top: 7px; padding: 11px 12px; border: 1px solid #d0d5dd; border-radius: 9px; background: #fff; font-size: 14px; }
  .control-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
  .primary, .secondary { border-radius: 9px; padding: 11px 16px; font-weight: 800; cursor: pointer; font-size: 14px; }
  .primary { border: 0; background: #101828; color: #fff; }
  .secondary { border: 1px solid #d0d5dd; background: #fff; color: #344054; }
  .print-button { padding-left: 20px; padding-right: 20px; }
  .error { color: #b42318 !important; font-size: 13px; margin-bottom: 0; }

  /* Modelo térmico: 80 mm, inspirado diretamente na via física enviada. */
  .receipt { width: 80mm; margin: 0 auto; background: #fff; padding: 5mm 4mm 6mm; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; }
  .receipt-date { font-size: 18px; font-weight: 900; margin: 0 0 5px 1px; line-height: 1.05; }
  .receipt-title { border: 1px solid #333; background: #ededed; text-align: center; font-size: 25px; font-weight: 900; padding: 7px 3px; text-transform: uppercase; line-height: 1.05; }
  .receipt-table { border: 1px solid #222; border-bottom: 0; margin-top: 0; }
  .receipt-row { display: grid; grid-template-columns: 1fr 26px 76px; min-height: 25px; border-bottom: 1px solid #777; align-items: stretch; }
  .receipt-row > * { padding: 4px 4px; display: flex; align-items: center; }
  .receipt-row > :nth-child(2) { border-left: 1px solid #777; border-right: 1px solid #777; }
  .receipt-row > :last-child { justify-content: flex-end; text-align: right; }
  .receipt-head { min-height: 29px; font-size: 13px; }
  .receipt-head > :last-child { justify-content: flex-end; }
  .blank-row { min-height: 27px; }
  .receipt-total { display: grid; grid-template-columns: 1fr 102px; min-height: 32px; border-bottom: 1px solid #222; align-items: center; font-size: 17px; font-weight: 900; }
  .receipt-total > * { padding: 4px; }
  .receipt-total strong { text-align: right; }
  .receipt-summary { margin-top: 5px; }
  .summary-row { display: grid; grid-template-columns: 1fr auto; align-items: center; font-size: 17px; padding: 2px 2px; min-height: 25px; }
  .balance-row { grid-template-columns: 1fr auto; border: 1px solid #222; padding: 4px 5px; font-size: 17px; }
  .balance-row span { display: flex; gap: 6px; align-items: center; }
  .payment-breakdown { margin-top: 10px; border-top: 1px solid #777; }
  .payment-row { display: grid; grid-template-columns: 1fr 26px 76px; min-height: 25px; align-items: center; }
  .payment-row > * { padding: 3px 4px; }
  .payment-row > :nth-child(2) { border-left: 1px solid #777; border-right: 1px solid #777; height: 100%; display: flex; align-items: center; }
  .payment-row > :last-child { text-align: right; }
  .payment-total { display: grid; grid-template-columns: 1fr 102px; min-height: 30px; align-items: center; font-size: 16px; font-weight: 900; border-bottom: 1px solid #222; }
  .payment-total > * { padding: 4px; }
  .payment-total strong { text-align: right; }
  .receipt-footer { text-align: center; font-weight: 900; font-size: 10px; margin-top: 9px; }

  @media print {
    @page { size: 80mm auto; margin: 0; }
    html, body { width: 80mm; margin: 0; padding: 0; background: #fff; }
    .no-print { display: none !important; }
    .print-page { min-height: 0; padding: 0; }
    .receipt { width: 80mm; margin: 0; padding: 4mm 4mm 6mm; box-shadow: none; }
  }

  @media (max-width: 760px) {
    .controls-grid { grid-template-columns: 1fr; }
    .control-actions { justify-content: stretch; }
    .control-actions button { flex: 1; }
  }
`}</style>
