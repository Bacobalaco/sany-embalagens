'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const moneyNumber = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (v) => v ? new Date(v + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const typeLabel = (v) => ({ sale: 'Compra', payment: 'Pagamento', credit: 'Crédito' }[v] || v);
const methodLabel = (v) => ({ credit: 'Conta', pix: 'PIX', cash: 'Dinheiro', card: 'Cartão', check: 'Cheque', transfer: 'Transferência', return: 'Devolução/Troca' }[v] || v || '—');

export default function ReportPrintPage() {
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = useMemo(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''), []);
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const customerId = params.get('customer_id') || '';
  const customerGroup = params.get('customer_group') || '';
  const kind = params.get('kind') || 'all';

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: c, error: ce }, { data: t, error: te }] = await Promise.all([
        supabase.from('customers').select('id,name,store_name').eq('active', true).order('name'),
        supabase.from('customer_transactions').select('id,customer_id,type,amount,payment_method,transaction_date,description,status').order('transaction_date', { ascending: true }).limit(5000),
      ]);
      if (ce || te) { setError((ce || te)?.message || 'Não foi possível carregar o relatório.'); setLoading(false); return; }
      setCustomers(c || []);
      setRows(t || []);
      setLoading(false);
    }
    load();
  }, []);

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const groupById = useMemo(() => new Map(customers.map(c => [c.id, (c.store_name || '').split(' • ')[0].trim()])), [customers]);

  const filtered = useMemo(() => rows.filter(x => {
    if (x.status !== 'posted' || !['sale', 'payment', 'credit'].includes(x.type)) return false;
    if (customerId && x.customer_id !== customerId) return false;
    if (customerGroup && groupById.get(x.customer_id) !== customerGroup) return false;
    if (from && x.transaction_date < from) return false;
    if (to && x.transaction_date > to) return false;
    if (kind === 'sales' && x.type !== 'sale') return false;
    if (kind === 'payments' && !['payment', 'credit'].includes(x.type)) return false;
    return true;
  }), [rows, customerId, customerGroup, groupById, from, to, kind]);

  const purchases = filtered.filter(x => x.type === 'sale').reduce((s, x) => s + Number(x.amount || 0), 0);
  const payments = filtered.filter(x => ['payment', 'credit'].includes(x.type)).reduce((s, x) => s + Number(x.amount || 0), 0);

  // Quando uma rede é selecionada, o relatório impresso vira uma grade semanal
  // de compras, no mesmo formato da planilha usada para conferência do cliente.
  const networkMatrix = useMemo(() => {
    if (!customerGroup) return null;
    const sales = filtered.filter(x => x.type === 'sale');
    const dateSet = new Set(sales.map(x => x.transaction_date));
    const dates = Array.from(dateSet).sort();
    const customerIds = Array.from(new Set(sales.map(x => x.customer_id)));
    const rowsByCustomer = customerIds.map(id => {
      const customer = customerMap.get(id);
      const byDate = {};
      sales.filter(x => x.customer_id === id).forEach(x => {
        byDate[x.transaction_date] = (byDate[x.transaction_date] || 0) + Number(x.amount || 0);
      });
      const total = Object.values(byDate).reduce((s, v) => s + v, 0);
      return { id, name: customer?.name || 'Cliente', byDate, total };
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    const columnTotals = Object.fromEntries(dates.map(d => [d, rowsByCustomer.reduce((s, r) => s + Number(r.byDate[d] || 0), 0)]));
    const grandTotal = Object.values(columnTotals).reduce((s, v) => s + v, 0);
    return { dates, rows: rowsByCustomer, columnTotals, grandTotal };
  }, [customerGroup, filtered, customerMap]);

  const title = customerGroup || (customerId ? (customerMap.get(customerId)?.store_name || customerMap.get(customerId)?.name) : '') || 'Relatório financeiro SANY';

  useEffect(() => {
    if (!loading && !error) {
      const timer = setTimeout(() => window.print(), 250);
      return () => clearTimeout(timer);
    }
  }, [loading, error]);

  if (loading) return <main className="print-loading">Carregando relatório…</main>;
  if (error) return <main className="print-loading">{error}</main>;

  if (networkMatrix) {
    return <main className="network-report">
      <div className="network-title-row">
        <div>
          <h1>{customerGroup.toUpperCase()}</h1>
          <div className="subtitle">RELATÓRIO DE COMPRAS — REDE COMPLETA</div>
        </div>
        <div className="period">{from || to ? `${from ? date(from) : 'Início'} até ${to ? date(to) : 'Hoje'}` : 'Todos os períodos'}</div>
      </div>
      <table className="matrix">
        <thead>
          <tr>
            <th className="customer-head">&nbsp;</th>
            {networkMatrix.dates.map(d => <th key={d}>{date(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {networkMatrix.rows.map(row => <tr key={row.id}>
            <td className="customer-name">{row.name}</td>
            {networkMatrix.dates.map(d => <td key={d}>{row.byDate[d] ? <><span className="currency">R$</span><span className="amount">{moneyNumber(row.byDate[d])}</span></> : ''}</td>)}
          </tr>)}
          <tr className="total-row">
            <td>TOTAL</td>
            {networkMatrix.dates.map(d => <td key={d}><span className="currency">R$</span><span className="amount">{moneyNumber(networkMatrix.columnTotals[d])}</span></td>)}
          </tr>
        </tbody>
      </table>
      <div className="network-footer"><strong>TOTAL DA REDE: {money(networkMatrix.grandTotal)}</strong><span>SANY EMBALAGENS</span></div>
      <style jsx>{`@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}.network-report{width:100%;font-size:12px}.network-title-row{display:flex;justify-content:space-between;align-items:flex-end;margin:0 0 8px;border-bottom:2px solid #111;padding-bottom:5px}.network-title-row h1{font-size:20px;margin:0}.subtitle{font-size:11px;font-weight:700;margin-top:2px}.period{font-size:11px}.matrix{width:100%;border-collapse:collapse;table-layout:fixed}.matrix th,.matrix td{border:1px solid #222;height:31px;padding:4px 6px}.matrix th{background:#fff;font-weight:700;text-align:right;white-space:nowrap;font-size:12px}.matrix th.customer-head{width:19%;background:#fff}.matrix td{background:#f4f4f4;text-align:right;white-space:nowrap;font-size:12px}.matrix td.customer-name{background:#86dc91;text-align:left;font-weight:700;font-size:12px}.matrix .currency{display:inline-block;margin-right:4px;float:left}.matrix .amount{font-weight:600}.matrix .total-row td{background:#fff21a;font-weight:800;font-size:12px}.matrix .total-row td:first-child{text-align:left}.network-footer{display:flex;justify-content:space-between;align-items:center;margin-top:7px;font-size:12px}.network-footer span{font-size:10px}@media print{.network-report{font-size:12px}.matrix th,.matrix td{height:31px}.matrix th,.matrix td,.matrix td.customer-name,.matrix .total-row td{font-size:12px}.matrix td.customer-name{background:#86dc91 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.matrix .total-row td{background:#fff21a !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}`}</style>
    </main>;
  }

  return <main className="a4-report">
    <header className="report-header">
      <div><h1>SANY EMBALAGENS</h1><h2>{title}</h2></div>
      <div className="report-meta"><strong>Relatório financeiro</strong><span>{from || to ? `${from ? date(from) : 'Início'} até ${to ? date(to) : 'Hoje'}` : 'Todos os períodos'}</span><span>Emitido em {new Date().toLocaleDateString('pt-BR')}</span></div>
    </header>
    <section className="report-summary"><div><small>Compras</small><strong>{money(purchases)}</strong></div><div><small>Pagamentos / créditos</small><strong>{money(payments)}</strong></div><div><small>Saldo do filtro</small><strong>{money(purchases - payments)}</strong></div><div><small>Lançamentos</small><strong>{filtered.length}</strong></div></section>
    <table><thead><tr><th>Data</th><th>Cliente</th><th>Tipo</th><th>Forma</th><th>Observação</th><th className="value">Valor</th></tr></thead><tbody>{filtered.length ? filtered.map(x => <tr key={x.id}><td>{date(x.transaction_date)}</td><td>{customerMap.get(x.customer_id)?.store_name || customerMap.get(x.customer_id)?.name || '—'}</td><td>{typeLabel(x.type)}</td><td>{methodLabel(x.payment_method)}</td><td>{x.description || '—'}</td><td className="value">{money(x.amount)}</td></tr>) : <tr><td colSpan="6" className="empty">Nenhum lançamento encontrado.</td></tr>}</tbody></table>
    <footer>SANY EMBALAGENS — Relatório gerado pelo sistema financeiro</footer>
    <style jsx>{`@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}.a4-report{width:100%;font-size:11px}.report-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}.report-header h1{font-size:22px;margin:0 0 4px}.report-header h2{font-size:16px;margin:0}.report-meta{text-align:right;display:flex;flex-direction:column;gap:3px}.report-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}.report-summary>div{border:1px solid #bbb;border-radius:5px;padding:8px}.report-summary small{display:block;font-size:9px;text-transform:uppercase;color:#555}.report-summary strong{display:block;font-size:14px;margin-top:3px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:6px 7px;text-align:left;vertical-align:top}th{background:#eee;font-size:10px;text-transform:uppercase}td.value,th.value{text-align:right;white-space:nowrap}.empty{text-align:center;padding:20px}footer{margin-top:14px;border-top:1px solid #bbb;padding-top:8px;text-align:center;font-size:9px;color:#555}.print-loading{font-family:Arial,sans-serif;padding:30px}@media print{.a4-report{font-size:10px}.report-summary>div{break-inside:avoid}tr{break-inside:avoid}}`}</style>
  </main>;
}
