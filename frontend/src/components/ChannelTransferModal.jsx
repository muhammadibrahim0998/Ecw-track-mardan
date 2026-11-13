import React, { useState, useEffect } from 'react';
import { ArrowRightLeft, X, DollarSign, Building2, AlertCircle } from 'lucide-react';

export default function ChannelTransferModal({
  isOpen,
  onClose,
  target = 'BANK', // 'BANK' | 'CASH'
  title,
  subtitle,
  availableCash = 0,
  availableBank = 0,
  onConfirm, // async (target, amount) => Promise<void>
  currency = 'Rs.',
  contextName = 'Records'
}) {
  const [currentTarget, setCurrentTarget] = useState(target);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentTarget(target);
      const defaultMax = target === 'BANK' ? Number(availableCash || 0) : Number(availableBank || 0);
      setAmount(defaultMax > 0 ? String(defaultMax) : '');
      setError(null);
      setLoading(false);
    }
  }, [isOpen, target, availableCash, availableBank]);

  if (!isOpen) return null;

  const isToBank = currentTarget === 'BANK';
  const cashNum = Number(availableCash || 0);
  const bankNum = Number(availableBank || 0);
  const maxAvailable = isToBank ? cashNum : bankNum;

  const handle1ClickAll = () => {
    setAmount(String(maxAvailable > 0 ? maxAvailable : 0));
    setError(null);
  };

  const handleFormSubmit = async (e) => {
    if (e) e.preventDefault();
    const numAmt = Number(amount);
    if (!amount || isNaN(numAmt) || numAmt <= 0) {
      setError('Please enter a valid amount greater than 0');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onConfirm(currentTarget, numAmt);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border-2 border-slate-300 overflow-hidden transform transition-all">
        {/* Header */}
        <div className={`p-5 flex items-center justify-between text-white ${
          isToBank
            ? 'bg-gradient-to-r from-emerald-600 to-emerald-700'
            : 'bg-gradient-to-r from-blue-600 to-blue-700'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center shrink-0 shadow-inner">
              <ArrowRightLeft className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-black text-sm uppercase tracking-wider">
                {title || (isToBank ? 'Send Cash to Bank' : 'Send Bank Funds to Cash')}
              </h3>
              <p className="text-[10.5px] text-white/80 font-bold mt-0.5">
                {subtitle || (isToBank
                  ? `Transfer cash funds into bank account (${contextName})`
                  : `Transfer bank funds back into cash (${contextName})`)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center text-white cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Direction Switcher Toggle */}
        <div className="p-3 bg-slate-100 border-b border-slate-200 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCurrentTarget('BANK');
              setAmount(cashNum > 0 ? String(cashNum) : '');
              setError(null);
            }}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              isToBank
                ? 'bg-emerald-600 text-white shadow-md border border-emerald-500 scale-[1.02]'
                : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>⇄ SEND TO BANK</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setCurrentTarget('CASH');
              setAmount(bankNum > 0 ? String(bankNum) : '');
              setError(null);
            }}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              !isToBank
                ? 'bg-blue-600 text-white shadow-md border border-blue-500 scale-[1.02]'
                : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>⇄ SEND TO CASH</span>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleFormSubmit} className="p-5 space-y-4">
          {/* Available balances card */}
          <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600 uppercase flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Available Cash:
              </span>
              <span className="font-black text-emerald-700 text-sm">
                {currency} {cashNum.toLocaleString('en-PK')}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600 uppercase flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-blue-600" /> Available Bank:
              </span>
              <span className="font-black text-blue-700 text-sm">
                {currency} {bankNum.toLocaleString('en-PK')}
              </span>
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-xs font-black uppercase text-black mb-1.5">
              Enter Amount to Transfer ({currency})
            </label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter amount..."
              autoFocus
              className="w-full px-4 py-3 rounded-2xl border-2 border-slate-300 font-black text-base text-slate-900 focus:outline-none focus:border-emerald-500 bg-white"
            />
          </div>

          {/* ⚡ 1-Click All Quick Preset Button */}
          <button
            type="button"
            onClick={handle1ClickAll}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 border-2 border-slate-300 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-98"
          >
            <span>⚡ 1-Click All: {currency} {maxAvailable.toLocaleString('en-PK')}</span>
          </button>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-700 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="text-[10px] text-slate-500 font-bold bg-amber-50 border border-amber-200 rounded-xl p-2.5">
            💡 Clicking confirm will dynamically update the records in the database across all branches, reports, and ledgers.
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border-2 border-slate-300 font-black text-xs text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider text-white shadow-md active:translate-y-0.5 cursor-pointer flex items-center gap-2 ${
                isToBank
                  ? 'bg-emerald-600 hover:bg-emerald-700 border-b-2 border-b-emerald-900'
                  : 'bg-blue-600 hover:bg-blue-700 border-b-2 border-b-blue-900'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>
                {loading
                  ? 'Transferring...'
                  : (isToBank ? 'Confirm Send to Bank' : 'Confirm Send to Cash')}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

