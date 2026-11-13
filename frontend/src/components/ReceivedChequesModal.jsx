import React, { useState, useMemo, useEffect } from 'react';
import {
  X, DollarSign, Building2, Calendar, CheckCircle2,
  AlertCircle, Search, Trash2, Printer, Plus, ArrowDownLeft,
  Loader2, Filter, ArrowRightLeft, Clock
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const POPULAR_BANKS = [
  'Meezan Bank',
  'Habib Bank Limited (HBL)',
  'MCB Bank',
  'United Bank Limited (UBL)',
  'Bank of Khyber (BOK)',
  'Allied Bank Limited (ABL)',
  'Bank Alfalah',
  'Faysal Bank',
  'Askari Bank',
  'National Bank of Pakistan (NBP)',
  'Dubai Islamic Bank',
  'Standard Chartered Bank',
  'Cash Counter Cheque',
  'Other Bank'
];

export function ReceivedChequesModal({
  isOpen,
  onClose,
  initialChannel = 'CASH',
  availableCash = 0,
  availableBank = 0,
  chequesList = [],
  currency = 'Rs.',
  shopName = 'Peshawar Branch',
  onSubmitCheque,
  onDeleteCheque
}) {
  const [channel, setChannel] = useState(initialChannel || 'CASH');
  const [listFilter, setListFilter] = useState('CURRENT'); // 'CURRENT' | 'ALL' | 'CASH' | 'BANK'
  const [chequeNumber, setChequeNumber] = useState('');
  const [bankName, setBankName] = useState('Meezan Bank');
  const [customBankName, setCustomBankName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [amount, setAmount] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Sync initial channel when opened
  useEffect(() => {
    if (isOpen) {
      const activeCh = String(initialChannel || 'CASH').toUpperCase();
      setChannel(activeCh);
      setListFilter('CURRENT');
      setError(null);
      setSuccessMsg(null);
      setChequeNumber('');
      setCustomerName('');
      setAmount('');
      setSearchTerm('');
    }
  }, [isOpen, initialChannel]);

  // Cheque list categorization
  const cashCheques = useMemo(() => {
    return (chequesList || []).filter(c => String(c.channel || '').toUpperCase() === 'CASH');
  }, [chequesList]);

  const bankCheques = useMemo(() => {
    return (chequesList || []).filter(c => String(c.channel || '').toUpperCase() === 'BANK');
  }, [chequesList]);

  const totalCashChequesAmt = useMemo(() => {
    return cashCheques.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  }, [cashCheques]);

  const totalBankChequesAmt = useMemo(() => {
    return bankCheques.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  }, [bankCheques]);

  // Which list to display in table
  const displayedCheques = useMemo(() => {
    let base = chequesList || [];
    if (listFilter === 'CURRENT') {
      base = channel === 'BANK' ? bankCheques : cashCheques;
    } else if (listFilter === 'CASH') {
      base = cashCheques;
    } else if (listFilter === 'BANK') {
      base = bankCheques;
    }
    const q = (searchTerm || '').trim().toLowerCase();
    if (!q) return base;
    return base.filter(c =>
      (c.chequeNumber || '').toLowerCase().includes(q) ||
      (c.customerName || '').toLowerCase().includes(q) ||
      (c.bankName || '').toLowerCase().includes(q) ||
      (c.notes || '').toLowerCase().includes(q)
    );
  }, [chequesList, listFilter, channel, bankCheques, cashCheques, searchTerm]);

  const formatDateTime = (createdAt, chequeDate) => {
    if (createdAt) {
      const d = new Date(createdAt);
      if (!isNaN(d.getTime())) {
        const datePart = d.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });
        const timePart = d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        return `${datePart} • ${timePart}`;
      }
    }
    if (chequeDate) {
      const d = new Date(chequeDate);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });
      }
    }
    return '-';
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const payAmt = Number(amount);
    if (isNaN(payAmt) || payAmt <= 0) {
      setError('Please enter a valid amount greater than 0');
      return;
    }
    if (!chequeNumber.trim()) {
      setError('Please enter the cheque number / ref');
      return;
    }

    const finalBank = bankName === 'Other Bank' ? (customBankName.trim() || 'Other Bank') : bankName;

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const payload = {
        channel, // 'BANK' or 'CASH'
        chequeNumber: chequeNumber.trim(),
        bankName: finalBank,
        customerName: customerName.trim() || 'Walk-in Customer',
        customerPhone: '',
        amount: payAmt,
        status: 'CLEARED',
        chequeDate: new Date().toISOString().split('T')[0],
        notes: `Received via ${channel === 'BANK' ? 'Bank Account' : 'Cash Drawer'}`
      };

      if (onSubmitCheque) {
        await onSubmitCheque(payload);
      }

      setSuccessMsg(`✓ Cheque ${payload.chequeNumber} of ${currency} ${payAmt.toLocaleString('en-PK')} received successfully into ${channel === 'BANK' ? 'Bank Account' : 'Cash Drawer'}!`);

      // Reset fields
      setChequeNumber('');
      setCustomerName('');
      setAmount('');

      setTimeout(() => {
        setSuccessMsg(null);
      }, 4000);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to record cheque');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintPDF = () => {
    const doc = new jsPDF();
    const isBank = channel === 'BANK';
    const total = displayedCheques.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const title = `${channel === 'BANK' ? 'Bank' : 'Cash'} Received Cheques Register`;

    doc.setFontSize(15);
    doc.text(`${shopName} - ${title}`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleDateString('en-PK')} | Total Amount: ${currency} ${total.toLocaleString('en-PK')} (${displayedCheques.length} Cheques)`, 14, 22);

    const headers = [['#', 'Date & Time', 'Cheque #', 'Drawer', 'Bank Name', 'Payer / Customer', 'Amount (Rs)']];
    const data = displayedCheques.map((c, idx) => [
      idx + 1,
      formatDateTime(c.createdAt, c.chequeDate),
      c.chequeNumber || '-',
      c.channel || 'CASH',
      c.bankName || '-',
      c.customerName || 'Customer',
      Number(c.amount || 0).toLocaleString('en-PK')
    ]);

    autoTable(doc, {
      head: headers,
      body: data,
      startY: 28,
      theme: 'grid',
      headStyles: { fillColor: isBank ? [21, 47, 18] : [217, 119, 6] }
    });

    doc.save(`${title.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.pdf`);
  };

  if (!isOpen) return null;

  const isBank = channel === 'BANK';
  const currentDrawerBalance = isBank ? availableBank : availableCash;
  const currentChequesCount = isBank ? bankCheques.length : cashCheques.length;
  const currentChequesSum = isBank ? totalBankChequesAmt : totalCashChequesAmt;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-2.5 sm:p-4 animate-in fade-in">
      <div className="bg-white border border-zinc-200 rounded-2xl sm:rounded-3xl max-w-2xl sm:max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-zinc-900 transition-all">
        {/* Header */}
        <div className={`px-4 sm:px-5 py-3 border-b flex items-center justify-between ${isBank
            ? 'bg-gradient-to-r from-[#0d220b] via-[#152F12] to-[#1e441a] text-white border-emerald-900'
            : 'bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white border-amber-600'
          }`}>
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ${isBank ? 'bg-emerald-500 text-white' : 'bg-white text-amber-600'
              }`}>
              {isBank ? <Building2 className="w-5 h-5" /> : <DollarSign className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black uppercase tracking-tight flex items-center gap-2">
                <span>{isBank ? 'Bank Cheque Receive' : 'Cash Cheque Receive'}</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full font-black uppercase bg-white/20 text-white border border-white/30">
                  {isBank ? 'Bank Account' : 'Cash Drawer'}
                </span>
              </h3>
              <p className="text-[10px] text-white/80 font-medium">
                {isBank ? 'Direct deposit received cheque into Bank Account' : 'Direct deposit received cheque into Cash Drawer'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Quick Switch Button */}
            <button
              type="button"
              onClick={() => {
                setChannel(isBank ? 'CASH' : 'BANK');
                setError(null);
                setSuccessMsg(null);
              }}
              className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1 border border-white/25 transition-all cursor-pointer"
              title={`Switch to ${isBank ? 'Cash Drawer' : 'Bank Account'}`}
            >
              <ArrowRightLeft className="w-3 h-3" />
              <span>{isBank ? 'Switch to Cash' : 'Switch to Bank'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-3.5 sm:p-4 overflow-y-auto flex-1 space-y-3.5">
          {/* Current Balance Banner */}
          <div className={`rounded-xl sm:rounded-2xl p-3 border flex flex-wrap items-center justify-between gap-2.5 ${isBank
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
              : 'bg-amber-50/80 border-amber-200 text-amber-950'
            }`}>
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black ${isBank ? 'bg-emerald-700 text-white' : 'bg-amber-500 text-white'
                }`}>
                {isBank ? <Building2 className="w-4 h-4" /> : <DollarSign className="w-4 h-4" />}
              </div>
              <div>
                <span className={`text-[9.5px] font-black uppercase tracking-wider block ${isBank ? 'text-emerald-800' : 'text-amber-800'
                  }`}>
                  {isBank ? 'Current Bank Balance' : 'Current Cash in Drawer'}
                </span>
                <h4 className={`text-lg sm:text-xl font-black tracking-tight ${isBank ? 'text-emerald-950' : 'text-amber-900'
                  }`}>
                  {currency} {Number(currentDrawerBalance || 0).toLocaleString('en-PK')}
                </h4>
              </div>
            </div>

            <div className="text-right">
              <span className={`text-[9px] font-bold uppercase block ${isBank ? 'text-emerald-700' : 'text-amber-700'
                }`}>
                Total Received Cheques:
              </span>
              <span className={`text-xs font-black ${isBank ? 'text-emerald-950' : 'text-amber-900'
                }`}>
                {currentChequesCount} Cheques • {currency} {Number(currentChequesSum || 0).toLocaleString('en-PK')}
              </span>
            </div>
          </div>

          {/* Alert Messages */}
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-600 text-xs font-bold rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* ══════════════ SIMPLE QUICK RECEIVE FORM ══════════════ */}
          <form onSubmit={handleSubmit} className="bg-zinc-50 border border-zinc-200 rounded-xl sm:rounded-2xl p-3 sm:p-3.5 space-y-2.5">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-1.5 mb-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-700 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-zinc-500" />
                <span>Receive Cheque to {isBank ? 'Bank' : 'Cash Drawer'}</span>
              </span>
              <span className="text-[9.5px] font-bold text-zinc-400">
                Enter details below to deposit
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
              {/* Field 1: Payer / Customer Name */}
              <div>
                <label className="text-[10px] font-black text-zinc-700 uppercase tracking-wider block mb-1">
                  Payer / Customer Name:
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="e.g. Tariq Traders / Walk-in"
                  className="w-full bg-white border border-zinc-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-zinc-900 outline-none focus:border-emerald-600"
                />
              </div>

              {/* Field 2: Cheque # */}
              <div>
                <label className="text-[10px] font-black text-zinc-700 uppercase tracking-wider block mb-1">
                  Cheque # / Ref: <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={chequeNumber}
                  onChange={e => setChequeNumber(e.target.value)}
                  placeholder="e.g. CHQ-981240"
                  className="w-full bg-white border border-zinc-300 rounded-lg px-2.5 py-1.5 text-xs font-black text-zinc-900 outline-none focus:border-emerald-600"
                />
              </div>

              {/* Field 3: Bank Name */}
              <div>
                <label className="text-[10px] font-black text-zinc-700 uppercase tracking-wider block mb-1">
                  Bank Name:
                </label>
                <select
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  className="w-full bg-white border border-zinc-300 rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-800 outline-none focus:border-emerald-600"
                >
                  {POPULAR_BANKS.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                {bankName === 'Other Bank' && (
                  <input
                    type="text"
                    value={customBankName}
                    onChange={e => setCustomBankName(e.target.value)}
                    placeholder="Type custom bank name"
                    className="mt-1 w-full bg-white border border-zinc-300 rounded-lg px-2 py-1 text-xs font-bold text-zinc-800 outline-none focus:border-emerald-600"
                  />
                )}
              </div>

              {/* Field 4: Amount to Enter */}
              <div>
                <label className="text-[10px] font-black text-zinc-700 uppercase tracking-wider block mb-1">
                  Amount to Receive ({currency}): <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="e.g. 5003"
                  className={`w-full bg-white border border-zinc-300 rounded-lg px-2.5 py-1.5 text-xs font-black outline-none focus:border-emerald-600 ${isBank ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                />
              </div>
            </div>

            {/* Submit Action */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className={`flex-1 py-2 text-white rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer ${isBank
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-amber-500 hover:bg-amber-600'
                  }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Recording Cheque...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Receive to {isBank ? 'Bank Account' : 'Cash Drawer'}</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* ══════════════ CHEQUES LIST TABLE (DIRECTLY BELOW) ══════════════ */}
          <div className="space-y-2">
            {/* Table Control Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-black uppercase tracking-wider text-zinc-800 flex items-center gap-1">
                  <span>Received Cheques List</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-100 font-bold text-zinc-600">
                    {displayedCheques.length}
                  </span>
                </span>

                <div className="flex gap-1 ml-2">
                  <button
                    type="button"
                    onClick={() => setListFilter('CURRENT')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all cursor-pointer ${listFilter === 'CURRENT'
                        ? (isBank ? 'bg-emerald-700 text-white' : 'bg-amber-500 text-white')
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                      }`}
                  >
                    {isBank ? 'Bank Only' : 'Cash Only'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setListFilter('ALL')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all cursor-pointer ${listFilter === 'ALL'
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                      }`}
                  >
                    All ({chequesList.length})
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <Search className="w-3 h-3 text-zinc-400 absolute left-2 top-2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search cheques..."
                    className="w-36 sm:w-44 bg-zinc-50 border border-zinc-200 rounded-lg pl-7 pr-2 py-1 text-[11px] font-bold text-zinc-800 outline-none focus:border-emerald-600"
                  />
                </div>

                <button
                  type="button"
                  onClick={handlePrintPDF}
                  className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer border border-zinc-300"
                  title="Print Cheques Register PDF"
                >
                  <Printer className="w-3 h-3" />
                  <span>PDF</span>
                </button>
              </div>
            </div>

            {/* Table Container */}
            <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white shadow-xs">
              <div className="max-h-[260px] overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`text-[10px] uppercase font-black border-b sticky top-0 ${isBank
                      ? 'bg-emerald-50/70 text-emerald-900 border-emerald-100'
                      : 'bg-amber-50/70 text-amber-900 border-amber-100'
                    }`}>
                    <tr>
                      <th className="py-2 px-2.5">#</th>
                      <th className="py-2 px-2.5">Cheque #</th>
                      <th className="py-2 px-2.5">Payer / Customer</th>
                      <th className="py-2 px-2.5">Bank</th>
                      <th className="py-2 px-2.5">Date &amp; Time</th>
                      <th className="py-2 px-2.5 text-right">Amount ({currency})</th>
                      <th className="py-2 px-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-[11px]">
                    {displayedCheques.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-zinc-400 font-bold text-xs">
                          No received cheques found. Fill out the form above to add a cheque.
                        </td>
                      </tr>
                    ) : (
                      displayedCheques.map((c, idx) => {
                        const chequeIsBank = String(c.channel || '').toUpperCase() === 'BANK';
                        return (
                          <tr key={c.id || idx} className="hover:bg-zinc-50/80 transition-colors">
                            <td className="py-1.5 px-2.5 font-bold text-zinc-400">#{idx + 1}</td>
                            <td className="py-1.5 px-2.5 font-black text-zinc-900 font-mono">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${chequeIsBank
                                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                                  : 'bg-amber-50 text-amber-900 border-amber-200'
                                }`}>
                                {c.chequeNumber}
                              </span>
                            </td>
                            <td className="py-1.5 px-2.5 font-bold text-zinc-900">
                              {c.customerName || 'Customer'}
                            </td>
                            <td className="py-1.5 px-2.5 font-medium text-zinc-600">
                              {c.bankName}
                            </td>
                            <td className="py-1.5 px-2.5 text-zinc-600 whitespace-nowrap text-[10px]">
                              {formatDateTime(c.createdAt, c.chequeDate)}
                            </td>
                            <td className={`py-1.5 px-2.5 font-black text-right whitespace-nowrap ${chequeIsBank ? 'text-emerald-700' : 'text-amber-700'
                              }`}>
                              {currency} {Number(c.amount || 0).toLocaleString('en-PK')}
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => onDeleteCheque && onDeleteCheque(c.id)}
                                className="p-1 rounded-md text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition-colors cursor-pointer"
                                title="Delete cheque"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReceivedChequesModal;
