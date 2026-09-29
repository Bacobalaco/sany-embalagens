'use client';

import { useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const moneyNumber = (v) => Number(v || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const methodLabel = (v) => ({
  credit: 'CONTA',
  pix: 'PIX',
  cash: 'DINHEIRO',
  card: 'CARTÃO',
  check: 'CHEQUE',
  transfer: 'TRANSFERÊNCIA',
  other: 'OUTRO',
}[v] || 'OUTRO');

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function buildReceipt({ customer, rows }) {
  const existing = document.getElementById('sany-inline-print-receipt');
  if (existing) existing.remove();

  const purchases = rows.filter((x) => x.type === 'sale');
  const payments = rows.filter((x) => ['payment', 'credit'].includes(x.type));
  const totalPurchases = purchases.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const totalPayments = payments.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const balance = totalPurchases - totalPayments;
  const byMethod = Array.from(payments.reduce((map, x) => {
    const key = x.payment_method || 'other';
    map.set(key, (map.get(key) || 0) + Number(x.amount || 0));
    return map;
  }, new Map()).entries());

  const today = new Date().toLocaleDateString('pt-BR');
  const purchaseRows = purchases.map((x) => `
    <div class="receipt-row data-row">
      <span>${escapeText((x.description || 'COMPRA').toUpperCase())}</span>
      <span>R$</span>
      <strong>${moneyNumber(x.amount)}</strong>
    </div>
  `).join('');

  const blankRows = Array.from({ length: Math.max(0, 8 - purchases.length) }, () => `
    <div class="receipt-row blank-row"><span></span><span></span><span></span></div>
  `).join('');

  const paymentRows = byMethod.map(([method, amount]) => `
    <div class="payment-row">
      <strong>${escapeText(methodLabel(method))}</strong>
      <span>R$</span>
      <strong>${moneyNumber(amount)}</strong>
    </div>
  `).join('');

  const receipt = document.createElement('section');
  receipt.id = 'sany-inline-print-receipt';
  receipt.className = 'inline-print-receipt';
  receipt.innerHTML = `
    <div class="receipt-date">${today}</div>
    <div class="receipt-title">${escapeText(customer?.name || 'CLIENTE')}</div>

    <div class="receipt-section purchase-section">
      <div class="receipt-row receipt-head"><strong>DEVE</strong><span>R$</span><strong>VALOR</strong></div>
      ${purchaseRows}
      ${blankRows}
      <div class="receipt-total"><span>R$</span><strong>${moneyNumber(totalPurchases)}</strong></div>
    </div>

    <div class="receipt-summary">
      <div class="summary-row paid-row"><strong>PAGOU</strong><strong>${moneyNumber(totalPayments)}</strong></div>
      <div class="summary-row balance-row"><strong>DEVE</strong><span><b>R$</b><strong>${moneyNumber(balance)}</strong></span></div>
    </div>

    <div class="payment-section">
      ${paymentRows || '<div class="payment-row"><strong></strong><span>R$</span><strong>0,00</strong></div>'}
      <div class="payment-total"><span>R$</span><strong>${moneyNumber(totalPayments)}</strong></div>
    </div>

    <div class="receipt-footer">SANY EMBALAGENS</div>
  `;

  document.body.appendChild(receipt);
}

export default function PrintInterceptor() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let pendingCustomerId = '';
    const originalPrint = window.print.bind(window);
    let printing = false;

    const captureCustomer = (event) => {
      const button = event.target?.closest?.('button');
      if (!button) return;
      const text = (button.textContent || '').toLowerCase();
      if (!text.includes('imprimir')) return;

      const selects = Array.from(document.querySelectorAll('select'));
      const selected = selects.find((select) => select.value);
      if (selected?.value) pendingCustomerId = selected.value;
    };

    const printWithReceipt = async () => {
      if (printing || !pendingCustomerId) {
        originalPrint();
        return;
      }

      printing = true;
      try {
        const [{ data: customer }, { data: rows, error }] = await Promise.all([
          supabase.from('customers').select('id,name,store_name').eq('id', pendingCustomerId).maybeSingle(),
          supabase.from('customer_transactions')
            .select('id,customer_id,type,amount,payment_method,transaction_date,description,status')
            .eq('customer_id', pendingCustomerId)
            .eq('status', 'posted')
            .in('type', ['sale', 'payment', 'credit'])
            .order('transaction_date', { ascending: true }),
        ]);

        if (error || !customer) {
          originalPrint();
          return;
        }

        buildReceipt({ customer, rows: rows || [] });
        originalPrint();
      } finally {
        setTimeout(() => {
          document.getElementById('sany-inline-print-receipt')?.remove();
          pendingCustomerId = '';
          printing = false;
        }, 1000);
      }
    };

    document.addEventListener('click', captureCustomer, true);
    window.print = printWithReceipt;

    return () => {
      document.removeEventListener('click', captureCustomer, true);
      window.print = originalPrint;
      document.getElementById('sany-inline-print-receipt')?.remove();
    };
  }, []);

  return null;
}
