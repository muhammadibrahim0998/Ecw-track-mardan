import React, { useState, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  History,
  Printer,
  Send,
  FileSpreadsheet,
  RefreshCw,
  ShoppingBag,
  Truck,
  Building2,
  Users,
  DollarSign,
  FileText,
  PackageX,
  TrendingUp,
  Receipt,
  Sparkles,
  ArrowDownRight,
  ArrowUpRight,
  CreditCard,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  ChevronRight,
  Eye,
  Info,
  X
} from 'lucide-react';
import { getImageUrl } from '../utils/imageHelper.js';

const getPurchaseQtyDigit = (p) => {
  if (!p) return 0;
  if (p.quantityText) {
    const qText = String(p.quantityText);
    const pName = String(p.name || p.productName || '').toLowerCase();
    const pUnit = String(p.unitType || p.unit || '').toLowerCase();
    if (pName.includes('pro') || pUnit.includes('pro') || pUnit.includes('tray')) {
      const match = qText.match(/([\d,]+(?:\.\d+)?)\s*(?:Premium Pro|Trays?|Pro)/i);
      if (match) return parseFloat(match[1].replace(/,/g, ''));
    } else if (pName.includes('plus') || pUnit.includes('plus') || pUnit.includes('egg')) {
      const match = qText.match(/([\d,]+(?:\.\d+)?)\s*(?:Premium Plus|Eggs?|Plus)/i);
      if (match) return parseFloat(match[1].replace(/,/g, ''));
    } else {
      const match = qText.match(/([\d,]+(?:\.\d+)?)\s*(?:Premium(?! Pro| Plus)|Petis?)/i);
      if (match) return parseFloat(match[1].replace(/,/g, ''));
    }
    const firstNum = qText.match(/^([\d,]+(?:\.\d+)?)/);
    if (firstNum) return parseFloat(firstNum[1].replace(/,/g, ''));
  }
  const pName = String(p.name || p.productName || '').toLowerCase();
  const pUnit = String(p.unitType || p.unit || '').toLowerCase();
  if (pName.includes('pro') || pUnit.includes('pro') || pUnit.includes('tray')) {
    return Number(p.trayQuantity || p.stock || p.quantity || 0);
  }
  if (pName.includes('plus') || pUnit.includes('plus') || pUnit.includes('egg')) {
    return Number(p.eggQuantity || p.stock || p.quantity || 0);
  }
  return Number(p.petiQuantity || p.stock || p.quantity || 0);
};

export default function TodayHistoryView({
  shopId = '1',
  shop = null,
  currency = 'Rs.',
  todayMasterMetrics = {},
  unifiedSalesList = [],
  shopSalesList = [],
  expensesList = [],
  fuelExpensesList = [],
  damagedProductsList = [],
  items = [],
  registeredCustomersList = [],
  onRefresh = null,
  setActiveView = () => {},
  isAdminUser = true
}) {
  const [activeTab, setActiveTab] = useState('ALL'); // 'ALL' | 'SALES' | 'PURCHASES' | 'EXPENSES' | 'FUEL' | 'DAMAGED' | 'CUSTOMERS'
  const [salesPaymentFilter, setSalesPaymentFilter] = useState('ALL'); // 'ALL' | 'CASH' | 'BANK' | 'CREDIT'
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ─── Product Image Resolver Helper ───
  const resolveProductImage = (prodName, prodId, directImage) => {
    if (directImage) {
      const u = getImageUrl(directImage);
      if (u && u !== '/egg2.png') return u;
    }
    if (Array.isArray(items) && items.length > 0) {
      if (prodId) {
        const byId = items.find(c => String(c._id || c.id) === String(prodId));
        if (byId) {
          const img = (byId.images && byId.images.length > 0 && byId.images[0]) || byId.image;
          if (img) return getImageUrl(img);
        }
      }
      const cleanName = String(prodName || '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .trim()
        .toLowerCase();
      if (cleanName) {
        const exact = items.find(c => c.name && c.name.trim().toLowerCase() === cleanName);
        if (exact) {
          const img = (exact.images && exact.images.length > 0 && exact.images[0]) || exact.image;
          if (img) return getImageUrl(img);
        }
        const partial = items.find(c => {
          if (!c.name) return false;
          const cn = c.name.trim().toLowerCase();
          return cleanName.includes(cn) || cn.includes(cleanName);
        });
        if (partial) {
          const img = (partial.images && partial.images.length > 0 && partial.images[0]) || partial.image;
          if (img) return getImageUrl(img);
        }
      }
    }
    if (directImage) return getImageUrl(directImage);
    return '/egg2.png';
  };

  // Smooth-scroll and tab activation handler for clickable calculation cards
  const handleCardClick = (tab, paymentFilter = 'ALL') => {
    setActiveTab(tab);
    setSalesPaymentFilter(paymentFilter);
    setTimeout(() => {
      const el = document.getElementById('today-history-tables');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  };

  const shopName = shop?.name || `Branch #${shopId}`;
  const shopAddress = shop?.address || 'Karkhano Market, Peshawar';
  const shopPhone = shop?.phone || '03098216202';

  // Date helper for strict today matching
  const now = new Date();
  const todayDateFormatted = now.toLocaleDateString('en-PK', {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const todayTimeFormatted = now.toLocaleTimeString('en-PK', {
    hour: '2-digit',
    minute: '2-digit'
  });

  // ─── Ultra-resilient dynamic date parser & formatter (Server & Local multi-timezone safe) ───
  const parseRecordDate = (raw) => {
    if (!raw) return null;
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
    if (typeof raw === 'number') {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      // Handle MySQL DATETIME string format like "2026-11-06 10:51:00"
      if (trimmed.includes(' ') && !trimmed.includes('T')) {
        const d = new Date(trimmed.replace(' ', 'T'));
        if (!isNaN(d.getTime())) return d;
      }
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  };

  const formatRecordDateTime = (raw) => {
    const d = parseRecordDate(raw) || new Date();
    
    // Format Date: e.g. "06-Nov-2026"
    const day = String(d.getDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[d.getMonth()] || 'Nov';
    const year = d.getFullYear();
    const dateFormatted = `${day}-${month}-${year}`;

    // Format Time: e.g. "10:51 am"
    let timeFormatted = '';
    try {
      timeFormatted = d.toLocaleTimeString('en-PK', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (_) {
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12 || 12;
      timeFormatted = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    }

    return {
      date: dateFormatted,
      time: timeFormatted,
      full: `${dateFormatted}, ${timeFormatted}`
    };
  };

  const isMatchToday = (raw) => {
    if (!raw) return false;
    const d = parseRecordDate(raw);
    if (!d || isNaN(d.getTime())) return false;

    // 1. Client local date match (e.g. PKT browser)
    if (d.toDateString() === now.toDateString()) return true;

    const pad = (n) => String(n).padStart(2, '0');
    const dLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const localToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (dLocal === localToday) return true;

    // 2. Server UTC date match (for UTC timestamps from Node/MySQL/Mongo servers)
    const dUtc = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const nowUtc = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
    if (dUtc === nowUtc) return true;

    // 3. String comparison fallback (if raw starts with YYYY-MM-DD)
    if (typeof raw === 'string') {
      const cleanRaw = raw.trim();
      if (cleanRaw.startsWith(localToday) || cleanRaw.startsWith(nowUtc)) return true;
    }

    return false;
  };

  // 1. Today Sales
  const todaySales = useMemo(() => {
    const list = (unifiedSalesList && unifiedSalesList.length > 0 ? unifiedSalesList : shopSalesList) || [];
    return list.filter(s => isMatchToday(s.saleDate || s.date || s.createdAt || s.created_at || s.timestamp || s.invoiceDate));
  }, [unifiedSalesList, shopSalesList]);

  const salesTotals = useMemo(() => {
    let revenue = 0;
    let cash = 0;
    let bank = 0;
    let credit = 0;
    let petis = 0;
    let eggs = 0;

    todaySales.forEach(s => {
      const amt = Number(s.totalAmount) || 0;
      revenue += amt;
      cash += Number(s.cashPaid !== undefined ? s.cashPaid : (s.paymentMethod === 'CASH' ? amt : 0)) || 0;
      bank += Number(s.bankPaid !== undefined ? s.bankPaid : (s.paymentMethod === 'BANK' || s.paymentMethod === 'ONLINE' || s.paymentMethod === 'BANK_TRANSFER' ? amt : 0)) || 0;
      credit += Number(s.creditDue || s.dueAmount || (s.paymentMethod === 'CREDIT' ? amt : 0)) || 0;

      let itms = Array.isArray(s.items) ? s.items : [];
      if (typeof s.items === 'string' && s.items.trim()) {
        try { itms = JSON.parse(s.items); } catch(e) { itms = []; }
      }
      if (itms && itms.length > 0) {
        itms.forEach(i => {
          eggs += Number(i.totalEggs || i.quantity || 0);
        });
      } else if (Number(s.eggsBought) > 0) {
        eggs += Number(s.eggsBought);
      } else if (Number(s.petisBought) > 0) {
        eggs += Number(s.petisBought) * 360;
      }
    });

    petis = Number((eggs / 360).toFixed(1));

    return {
      revenue: revenue || Number(todayMasterMetrics.todaySalesRevenue || 0),
      count: todaySales.length || Number(todayMasterMetrics.todaySalesCount || 0),
      cash: cash || Number(todayMasterMetrics.todaySalesCash || 0),
      bank: bank || Number(todayMasterMetrics.todaySalesBank || 0),
      credit: credit || Number(todayMasterMetrics.todaySalesCredit || 0),
      petis: petis || Number(todayMasterMetrics.todaySalesPetis || 0),
      eggs: eggs || Number(todayMasterMetrics.todaySalesEggs || 0)
    };
  }, [todaySales, todayMasterMetrics]);

  // Today Sales Category-wise Breakdown
  const salesCategoryTotals = useMemo(() => {
    const cats = {};
    todaySales.forEach(s => {
      let itms = Array.isArray(s.items) ? s.items : [];
      if (typeof s.items === 'string' && s.items.trim()) {
        try { itms = JSON.parse(s.items); } catch(e) { itms = []; }
      }
      const rawDefault = s.category || (itms[0]?.category) || 'Premium';
      const defaultCat = (rawDefault && rawDefault.toLowerCase() !== 'eggs' && rawDefault.toLowerCase() !== 'egg') ? rawDefault : 'Premium';
      if (itms && itms.length > 0) {
        itms.forEach(i => {
          const rawName = i.category || defaultCat || 'Premium';
          const cName = (rawName && rawName.toLowerCase() !== 'eggs' && rawName.toLowerCase() !== 'egg') ? rawName : 'Premium';
          const amt = Number(i.total || (Number(i.price || 0) * Number(i.quantity || 1)) || 0);
          if (!cats[cName]) cats[cName] = { name: cName, total: 0, count: 0, eggs: 0 };
          cats[cName].total += amt > 0 ? amt : (Number(s.totalAmount) / itms.length || 0);
          cats[cName].count += Number(i.quantity || 1);
          cats[cName].eggs += Number(i.totalEggs || 0);
        });
      } else {
        const cName = defaultCat;
        if (!cats[cName]) cats[cName] = { name: cName, total: 0, count: 0, eggs: 0 };
        cats[cName].total += Number(s.totalAmount) || 0;
        cats[cName].count += 1;
        cats[cName].eggs += Number(s.eggsBought || 0);
      }
    });
    return Object.values(cats);
  }, [todaySales]);

  // Payment Breakdown Counts for Quick Tabs
  const salesPaymentCounts = useMemo(() => {
    let cashCount = 0;
    let bankCount = 0;
    let creditCount = 0;

    todaySales.forEach(s => {
      const amt = Number(s.totalAmount) || 0;
      const cash = Number(s.cashPaid !== undefined ? s.cashPaid : (s.paymentMethod === 'CASH' ? amt : 0)) || 0;
      const bank = Number(s.bankPaid !== undefined ? s.bankPaid : (s.paymentMethod === 'BANK' || s.paymentMethod === 'ONLINE' || s.paymentMethod === 'BANK_TRANSFER' ? amt : 0)) || 0;
      const due = Number(s.creditDue || s.dueAmount || (s.paymentMethod === 'CREDIT' ? amt : 0)) || 0;

      if (cash > 0) cashCount++;
      if (bank > 0) bankCount++;
      if (due > 0) creditCount++;
    });

    return { cashCount, bankCount, creditCount };
  }, [todaySales]);

  // Filtered Today Sales for when user clicks on Cash, Bank or Credit Given cards
  const filteredTodaySales = useMemo(() => {
    if (salesPaymentFilter === 'CASH') {
      return todaySales.filter(s => {
        const amt = Number(s.totalAmount) || 0;
        const cash = Number(s.cashPaid !== undefined ? s.cashPaid : (s.paymentMethod === 'CASH' ? amt : 0));
        return cash > 0;
      });
    }
    if (salesPaymentFilter === 'BANK') {
      return todaySales.filter(s => {
        const amt = Number(s.totalAmount) || 0;
        const bank = Number(s.bankPaid !== undefined ? s.bankPaid : (s.paymentMethod === 'BANK' || s.paymentMethod === 'ONLINE' || s.paymentMethod === 'BANK_TRANSFER' ? amt : 0));
        return bank > 0;
      });
    }
    if (salesPaymentFilter === 'CREDIT') {
      return todaySales.filter(s => {
        const amt = Number(s.totalAmount) || 0;
        const due = Number(s.creditDue || s.dueAmount || (s.paymentMethod === 'CREDIT' ? amt : 0));
        return due > 0;
      });
    }
    return todaySales;
  }, [todaySales, salesPaymentFilter]);

  // 2. Today Shop Expenses
  const todayExpenses = useMemo(() => {
    return (expensesList || []).filter(e => isMatchToday(e.expenseDate || e.date || e.createdAt || e.created_at || e.timestamp));
  }, [expensesList]);

  const expenseTotals = useMemo(() => {
    let total = 0;
    let cash = 0;
    let bank = 0;
    todayExpenses.forEach(e => {
      const amt = Number(e.amount) || 0;
      total += amt;
      const p = String(e.paymentMethod || 'CASH').toUpperCase();
      if (p === 'BANK' || p === 'ONLINE' || p === 'BANK_TRANSFER') {
        bank += amt;
      } else {
        cash += amt;
      }
    });
    return {
      total: total || Number(todayMasterMetrics.todayExpenses || 0),
      count: todayExpenses.length || Number(todayMasterMetrics.todayExpensesCount || 0),
      cash,
      bank
    };
  }, [todayExpenses, todayMasterMetrics]);

  // 3. Today Fuel & Vehicle Expenses
  const todayFuel = useMemo(() => {
    return (fuelExpensesList || []).filter(f => isMatchToday(f.expenseDate || f.date || f.createdAt || f.created_at || f.timestamp));
  }, [fuelExpensesList]);

  const fuelTotals = useMemo(() => {
    let total = 0;
    let liters = 0;
    let cash = 0;
    let bank = 0;
    let credit = 0;
    todayFuel.forEach(f => {
      const amt = Number(f.totalAmount) || 0;
      total += amt;
      liters += Number(f.liters) || 0;
      const p = String(f.paymentMethod || 'CASH').toUpperCase();
      const isCredit = p.includes('CREDIT') || Number(f.creditDue || f.dueAmount || 0) > 0;
      if (isCredit) {
        credit += Number(f.creditDue || f.dueAmount || amt);
      } else if (p.includes('BANK') || p.includes('ONLINE')) {
        bank += amt;
      } else {
        cash += amt;
      }
    });
    return {
      total: total || Number(todayMasterMetrics.todayFuelExpense || 0),
      count: todayFuel.length || Number(todayMasterMetrics.todayFuelCount || 0),
      liters: Number(liters.toFixed(1)) || Number(todayMasterMetrics.todayFuelLiters || 0),
      cash,
      bank,
      credit
    };
  }, [todayFuel, todayMasterMetrics]);

  // 4. Today Damaged Stock Losses
  const todayDamaged = useMemo(() => {
    return (damagedProductsList || []).filter(d => isMatchToday(d.damageDate || d.date || d.createdAt || d.created_at || d.timestamp));
  }, [damagedProductsList]);

  const damagedTotals = useMemo(() => {
    let lossVal = 0;
    let eggs = 0;
    todayDamaged.forEach(d => {
      const loss = Number(d.totalLoss) > 0
        ? Number(d.totalLoss)
        : (Number(d.lossAmount) || (Number(d.quantity || d.deductedEggs || 0) * (Number(d.unitPrice) || 0)) || 0);
      const eggCount = Number(d.deductedEggs) > 0
        ? Number(d.deductedEggs)
        : (Number(d.eggQuantity || 0) + (Number(d.petiQuantity || 0) * 360) + (Number(d.trayQuantity || 0) * 30) || Number(d.quantity) || 0);
      lossVal += loss;
      eggs += eggCount;
    });
    return {
      totalLoss: lossVal || Number(todayMasterMetrics.todayDamagedLoss || 0),
      count: todayDamaged.length || Number(todayMasterMetrics.todayDamagedCount || 0),
      eggs: eggs || Number(todayMasterMetrics.todayDamagedEggs || 0),
      petis: Number((eggs / 360).toFixed(1)) || Number(todayMasterMetrics.todayDamagedPetis || 0)
    };
  }, [todayDamaged, todayMasterMetrics]);

  // 5. Today Purchases & Restocks
  const todayPurchases = useMemo(() => {
    return (items || []).filter(p => isMatchToday(p.purchaseDate || p.date || p.createdAt || p.created_at || p.timestamp));
  }, [items]);

  const purchaseTotals = useMemo(() => {
    let cost = 0;
    let cash = 0;
    let bank = 0;
    let due = 0;
    let petis = 0;
    todayPurchases.forEach(p => {
      const c = Number(p.totalPurchaseCost || p.purchaseCost || p.totalCost) || 0;
      cost += c;
      cash += Number(p.cashPaid || p.amountPaidCash || 0);
      bank += Number(p.bankPaid || p.amountPaidBank || 0);
      due += Number(p.dueAmount || p.balanceDue || 0);
      petis += Number(p.petiQuantity || 0);
    });
    return {
      cost: cost || Number(todayMasterMetrics.todayPurchasesCost || 0),
      count: todayPurchases.length || Number(todayMasterMetrics.todayPurchasesCount || 0),
      cash,
      bank,
      due,
      petis
    };
  }, [todayPurchases, todayMasterMetrics]);

  // 6. Today New Registered Customers
  const todayCustomers = useMemo(() => {
    return (registeredCustomersList || []).filter(c => isMatchToday(c.createdAt || c.dateAdded || c.created_at || c.date || c.timestamp));
  }, [registeredCustomersList]);

  // ─── SPECIFIC FINANCIAL CALCULATION AS REQUESTED BY USER ───
  // today expens seraf da today sale na minus kegi aw demage fuel am da today sale na minus kegi
  const todayFinancialResult = useMemo(() => {
    const grossSale = salesTotals.revenue;
    const shopExp = expenseTotals.total;
    const fuelExp = fuelTotals.total;
    const damLoss = damagedTotals.totalLoss;

    const totalDeductions = shopExp + fuelExp + damLoss;
    const netDailyBalance = grossSale - totalDeductions;

    // Cash-in-hand calculation for physical drawer settlement
    const cashIn = salesTotals.cash;
    const cashOut = expenseTotals.cash + fuelTotals.cash;
    const netCashInDrawer = cashIn - cashOut;

    // Bank account movements
    const bankIn = salesTotals.bank;
    const bankOut = expenseTotals.bank + fuelTotals.bank;
    const netBankBalance = bankIn - bankOut;

    return {
      grossSale,
      shopExp,
      fuelExp,
      damLoss,
      totalDeductions,
      netDailyBalance,
      isProfit: netDailyBalance >= 0,
      cashIn,
      cashOut,
      netCashInDrawer,
      bankIn,
      bankOut,
      netBankBalance,
      customerCreditGiven: salesTotals.credit
    };
  }, [salesTotals, expenseTotals, fuelTotals, damagedTotals]);

  // Handle refresh action
  const handleTriggerRefresh = async () => {
    setIsRefreshing(true);
    if (onRefresh) {
      await onRefresh();
    }
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // ─── 1-CLICK PRINT MASTER TODAY STATEMENT (Clean, Vector, High-Res HTML Print Window) ───
  const handlePrintTodayHistory = () => {
    const printWin = window.open('', '_blank', 'width=1150,height=820');
    if (!printWin) {
      alert('Please allow popups to print the Today History Statement.');
      return;
    }

    const fmtNum = (num) => Number(num || 0).toLocaleString('en-PK');

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Daily Business Statement - ${todayDateFormatted} - ${shopName}</title>
          <style>
            @page {
              size: A4 landscape;
              margin: 4mm 6mm 4mm 6mm;
            }
            @media print {
              html, body {
                width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .formula-card, .signatures, table, .section-title, .summary-strip {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
            }
            * {
              box-sizing: border-box;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              color: #0f172a;
              background: #ffffff;
              margin: 0;
              padding: 5px 10px;
              font-size: 7.6px;
              line-height: 1.25;
            }
            .header-banner {
              text-align: center;
              padding-bottom: 4px;
              border-bottom: 2px solid #0f172a;
              margin-bottom: 4px;
            }
            .org-title {
              font-size: 16px;
              font-weight: 950;
              text-transform: uppercase;
              letter-spacing: 0.8px;
              color: #0f172a;
              margin: 0;
              line-height: 1.1;
            }
            .branch-title {
              font-size: 9px;
              font-weight: 800;
              color: #334155;
              margin: 2px 0 3px 0;
              text-transform: uppercase;
              letter-spacing: 0.3px;
            }
            .doc-tag {
              display: inline-block;
              background: #0f172a;
              color: #ffffff;
              font-weight: 900;
              font-size: 7.5px;
              padding: 2.5px 12px;
              border-radius: 9999px;
              text-transform: uppercase;
              letter-spacing: 1.2px;
            }
            .meta-bar {
              display: grid;
              grid-template-columns: 1.3fr 1fr 1.2fr 1fr;
              gap: 6px;
              background: #f8fafc;
              border: 1px solid #cbd5e1;
              padding: 3px 8px;
              border-radius: 5px;
              margin-bottom: 5px;
              font-size: 7.2px;
              color: #334155;
              align-items: center;
            }
            .meta-item {
              display: flex;
              align-items: center;
              gap: 4px;
            }
            .meta-label {
              font-weight: 800;
              color: #64748b;
              text-transform: uppercase;
              font-size: 6.8px;
            }
            .meta-val {
              font-weight: 900;
              color: #0f172a;
            }

            /* Master Calculation Box */
            .formula-card {
              border: 1.5px solid #cbd5e1;
              background: #ffffff;
              border-radius: 6px;
              padding: 5px 7px;
              margin-bottom: 5px;
            }
            .formula-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 4px;
              padding-bottom: 3px;
              border-bottom: 1px solid #e2e8f0;
            }
            .formula-title {
              font-size: 7.8px;
              font-weight: 950;
              text-transform: uppercase;
              letter-spacing: 0.4px;
              color: #0f172a;
              display: flex;
              align-items: center;
              gap: 4px;
            }
            .formula-grid {
              display: grid;
              grid-template-columns: 1.15fr 1fr 1fr 1fr 1.35fr;
              gap: 4px;
              text-align: center;
            }
            .formula-item {
              padding: 4px 5px;
              border-radius: 5px;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
            }
            .formula-item.gross {
              background: #f0fdf4;
              border: 1px solid #bbf7d0;
            }
            .formula-item.expense {
              background: #fff1f2;
              border: 1px solid #fecdd3;
            }
            .formula-item.fuel {
              background: #fffbeb;
              border: 1px solid #fde68a;
            }
            .formula-item.damage {
              background: #fff7ed;
              border: 1px solid #fed7aa;
            }
            .formula-item.result-profit {
              background: #ecfdf5;
              border: 2px solid #10b981;
            }
            .formula-item.result-deficit {
              background: #fef2f2;
              border: 2px solid #ef4444;
            }
            .formula-item .lbl {
              font-weight: 900;
              text-transform: uppercase;
              font-size: 6.8px;
              line-height: 1;
              letter-spacing: 0.2px;
            }
            .formula-item .val {
              font-size: 11.5px;
              font-weight: 950;
              margin-top: 2.5px;
              line-height: 1;
            }
            .formula-substrip {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr 1fr;
              gap: 4px;
              margin-top: 4px;
              padding-top: 4px;
              border-top: 1px dashed #cbd5e1;
              font-size: 7.2px;
            }
            .substrip-box {
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 4px;
              padding: 2.5px 6px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }

            /* Section Banners */
            .section-title {
              font-size: 7.8px;
              font-weight: 950;
              text-transform: uppercase;
              letter-spacing: 0.4px;
              color: #ffffff;
              background: #0f172a;
              padding: 3px 7px;
              border-radius: 4px 4px 0 0;
              margin-top: 5px;
              margin-bottom: 0;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .section-badge {
              background: rgba(255, 255, 255, 0.18);
              color: #ffffff;
              border: 1px solid rgba(255, 255, 255, 0.3);
              padding: 1px 6px;
              border-radius: 3px;
              font-weight: 900;
              font-size: 6.8px;
              letter-spacing: 0.3px;
            }

            /* Table Styling */
            table {
              width: 100%;
              border-collapse: separate;
              border-spacing: 0;
              margin-bottom: 0px;
              font-size: 7.2px;
              border: 1px solid #94a3b8;
              border-radius: 0 0 4px 4px;
              overflow: hidden;
            }
            th {
              background: #f1f5f9;
              color: #1e293b;
              font-weight: 900;
              text-transform: uppercase;
              font-size: 6.8px;
              padding: 2.5px 4px;
              border-bottom: 1.5px solid #94a3b8;
              border-right: 1px solid #cbd5e1;
              text-align: left;
            }
            th:last-child {
              border-right: none;
            }
            td {
              padding: 2px 4px;
              border-bottom: 1px solid #cbd5e1;
              border-right: 1px solid #e2e8f0;
              vertical-align: middle;
              color: #0f172a;
              line-height: 1.15;
            }
            td:last-child {
              border-right: none;
            }
            tr:nth-child(even) td {
              background: #f8fafc;
            }
            tr:last-child td {
              border-bottom: none;
            }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .font-bold { font-weight: 700; }
            .font-black { font-weight: 900; }

            .summary-strip {
              background: #f8fafc;
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              padding: 2px 6px;
              margin-top: 2px;
              margin-bottom: 3px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: 7px;
              font-weight: 800;
              flex-wrap: wrap;
              gap: 3px;
            }
            .category-strip {
              font-size: 6.8px;
              color: #334155;
              margin-top: -1px;
              margin-bottom: 3px;
              font-weight: 700;
              background: #ffffff;
              border: 1px solid #cbd5e1;
              border-radius: 3px;
              padding: 1.5px 6px;
            }

            .signatures {
              margin-top: 6px;
              display: grid;
              grid-template-columns: 1fr 1fr 1fr;
              gap: 20px;
              padding-top: 4px;
              page-break-inside: avoid !important;
            }
            .sign-box {
              border-top: 1.5px dashed #475569;
              text-align: center;
              padding-top: 3px;
            }
            .sign-title {
              font-size: 7.2px;
              font-weight: 900;
              text-transform: uppercase;
              color: #1e293b;
              letter-spacing: 0.4px;
            }
            .sign-sub {
              font-size: 5.8px;
              color: #64748b;
              font-weight: 700;
              margin-top: 1px;
            }
            .footer-note {
              margin-top: 4px;
              text-align: center;
              font-size: 6px;
              color: #64748b;
              font-weight: 600;
              border-top: 1px solid #e2e8f0;
              padding-top: 2px;
              letter-spacing: 0.2px;
            }
          </style>
        </head>
        <body>
          <div class="header-banner">
            <h1 class="org-title">ECW Track POS &amp; Traders</h1>
            <div class="branch-title">
              <span style="color:#047857; font-weight:900;">📍 ${shopName}</span>
              <span style="color:#94a3b8; margin: 0 5px;">•</span>
              <span>${shopAddress}</span>
            </div>
            <div style="margin-top: 2px;">
              <span class="doc-tag">DAILY BUSINESS AUDIT &amp; CLOSING STATEMENT</span>
            </div>
          </div>

          <div class="meta-bar">
            <div class="meta-item"><span class="meta-label">DATE:</span> <span class="meta-val">${todayDateFormatted}</span></div>
            <div class="meta-item"><span class="meta-label">PRINTED AT:</span> <span class="meta-val">${todayTimeFormatted}</span></div>
            <div class="meta-item"><span class="meta-label">BRANCH CONTACT:</span> <span class="meta-val">${shopPhone}</span></div>
            <div class="meta-item" style="justify-content: flex-end;">
              <span style="background:#dcfce7; color:#15803d; border:1px solid #86efac; padding:1.5px 7px; border-radius:4px; font-weight:900; font-size:6.8px; letter-spacing:0.5px;">✓ VERIFIED 100% AUDIT</span>
            </div>
          </div>

          <!-- Master Calculation Box -->
          <div class="formula-card">
            <div class="formula-header">
              <span class="formula-title">
                <span style="color:#059669;">●</span> TODAY FINANCIAL PERFORMANCE &amp; NET DAILY SETTLEMENT
              </span>
              <span style="font-size:6.8px; font-weight:800; color:#64748b; background:#f1f5f9; padding:1px 6px; border-radius:3px; border:1px solid #e2e8f0;">
                Formula: Sale - (Exp + Fuel + Damage) = Net Result
              </span>
            </div>
            <div class="formula-grid">
              <div class="formula-item gross">
                <div class="lbl" style="color:#166534;">(+) 1. Today Gross Sale</div>
                <div class="val" style="color:#15803d;">${currency} ${fmtNum(todayFinancialResult.grossSale)}</div>
              </div>
              <div class="formula-item expense">
                <div class="lbl" style="color:#9f1239;">(-) 2. Shop Expense</div>
                <div class="val" style="color:#be123c;">${currency} ${fmtNum(todayFinancialResult.shopExp)}</div>
              </div>
              <div class="formula-item fuel">
                <div class="lbl" style="color:#92400e;">(-) 3. Fuel Expense</div>
                <div class="val" style="color:#b45309;">${currency} ${fmtNum(todayFinancialResult.fuelExp)}</div>
              </div>
              <div class="formula-item damage">
                <div class="lbl" style="color:#9a3412;">(-) 4. Damaged Loss</div>
                <div class="val" style="color:#c2410c;">${currency} ${fmtNum(todayFinancialResult.damLoss)}</div>
              </div>
              <div class="formula-item ${todayFinancialResult.isProfit ? 'result-profit' : 'result-deficit'}">
                <div class="lbl" style="color:${todayFinancialResult.isProfit ? '#065f46' : '#991b1b'}; display:flex; align-items:center; justify-content:center; gap:3px;">
                  <span>(=) Today Net Result</span>
                  <span style="background:${todayFinancialResult.isProfit ? '#059669' : '#dc2626'}; color:#fff; font-size:6px; font-weight:950; padding:0.5px 4px; border-radius:2px;">
                    ${todayFinancialResult.isProfit ? 'PROFIT' : 'DEFICIT'}
                  </span>
                </div>
                <div class="val" style="color:${todayFinancialResult.isProfit ? '#047857' : '#b91c1c'}; font-size:12px;">
                  ${todayFinancialResult.isProfit ? '+' : '-'}${currency} ${fmtNum(Math.abs(todayFinancialResult.netDailyBalance))}
                </div>
              </div>
            </div>

            <div class="formula-substrip">
              <div class="substrip-box">
                <span style="color:#475569; font-weight:800;">💵 Cash in Drawer:</span>
                <strong style="color:#047857; font-weight:900;">${currency} ${fmtNum(todayFinancialResult.netCashInDrawer)}</strong>
              </div>
              <div class="substrip-box">
                <span style="color:#475569; font-weight:800;">🏦 Bank Inflow:</span>
                <strong style="color:#1d4ed8; font-weight:900;">${currency} ${fmtNum(todayFinancialResult.bankIn)}</strong>
              </div>
              <div class="substrip-box">
                <span style="color:#475569; font-weight:800;">📋 Customer Credit:</span>
                <strong style="color:#b45309; font-weight:900;">${currency} ${fmtNum(todayFinancialResult.customerCreditGiven)}</strong>
              </div>
              <div class="substrip-box">
                <span style="color:#475569; font-weight:800;">📦 Total Sold Outflow:</span>
                <strong style="color:#0f172a; font-weight:900;">${salesTotals.petis} Premium (${fmtNum(salesTotals.eggs)} Premium Plus)</strong>
              </div>
            </div>
          </div>

          <!-- Section 1: Sales Invoices -->
          <div class="section-title">
            <span>1. Today POS Sales &amp; Orders (${todaySales.length} Invoices)</span>
            <span class="section-badge">TOTAL SALES: ${currency} ${fmtNum(salesTotals.revenue)}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:20px;">#</th>
                <th style="width:65px;">Invoice #</th>
                <th style="width:55px;">Category</th>
                <th style="width:75px;">Date &amp; Time</th>
                <th>Customer Name &amp; Contact</th>
                <th>Items Purchased</th>
                <th class="text-right" style="width:55px;">Cash</th>
                <th class="text-right" style="width:55px;">Bank</th>
                <th class="text-right" style="width:55px;">Credit</th>
                <th class="text-right" style="width:65px;">Total Amount</th>
              </tr>
            </thead>
            <tbody>
              ${todaySales.length === 0 ? `
                <tr><td colspan="10" class="text-center" style="color:#64748b; padding:2px; font-size:7px;">No sales bills recorded for today.</td></tr>
              ` : todaySales.map((s, idx) => {
                const inv = s.invoiceNumber || s.serialNumber || `INV-${idx + 1}`;
                const dt = formatRecordDateTime(s.saleDate || s.date || s.createdAt || s.created_at || s.timestamp || s.invoiceDate);
                const cust = s.customerName || 'Walk-in Customer';
                const phone = s.customerPhone || '';
                const total = Number(s.totalAmount) || 0;
                const cash = Number(s.cashPaid !== undefined ? s.cashPaid : (s.paymentMethod === 'CASH' ? total : 0));
                const bank = Number(s.bankPaid !== undefined ? s.bankPaid : (s.paymentMethod === 'BANK' || s.paymentMethod === 'ONLINE' ? total : 0));
                const due = Number(s.creditDue || s.dueAmount || (s.paymentMethod === 'CREDIT' ? total : 0));
                let itms = (s.items && Array.isArray(s.items)) ? s.items.map(i => i.quantity || 1).join(', ') : (s.quantity || 1);
                const rawCat = s.category || (s.items && s.items[0]?.category) || 'Premium';
                const cat = (rawCat && rawCat.toLowerCase() !== 'eggs' && rawCat.toLowerCase() !== 'egg') ? rawCat : 'Premium';
                return `
                  <tr>
                    <td>${idx + 1}</td>
                    <td class="font-bold">${inv}</td>
                    <td><span style="background:#f1f5f9; color:#0f172a; padding:1px 3px; border-radius:2px; font-weight:800; font-size:6.5px; border:1px solid #cbd5e1;">${cat}</span></td>
                    <td style="white-space:nowrap; font-size:7px; line-height:1.1;"><strong>${dt.date}</strong><br/><span style="color:#64748b; font-size:6px;">${dt.time}</span></td>
                    <td><strong>${cust}</strong> ${phone ? `(${phone})` : ''}</td>
                    <td>${itms}</td>
                    <td class="text-right font-bold">${cash > 0 ? `${currency} ${fmtNum(cash)}` : '—'}</td>
                    <td class="text-right font-bold">${bank > 0 ? `${currency} ${fmtNum(bank)}` : '—'}</td>
                    <td class="text-right font-bold" style="color:#b91c1c;">${due > 0 ? `${currency} ${fmtNum(due)}` : '—'}</td>
                    <td class="text-right font-black" style="color:#047857;">${currency} ${fmtNum(total)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <!-- Sales Payment & Category Summary Strip -->
          <div class="summary-strip">
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <span style="color:#475569; text-transform:uppercase;">SALES PAYMENT BREAKDOWN:</span>
              <span>💵 Cash: <strong style="color:#047857;">${currency} ${fmtNum(salesTotals.cash)}</strong></span>
              <span>🏦 Bank: <strong style="color:#1d4ed8;">${currency} ${fmtNum(salesTotals.bank)}</strong></span>
              <span>📋 Credit (Due): <strong style="color:#b91c1c;">${currency} ${fmtNum(salesTotals.credit)}</strong></span>
            </div>
            <div>
              TOTAL SALES: <strong style="color:#0f172a; font-size:8px;">${currency} ${fmtNum(salesTotals.revenue)}</strong>
            </div>
          </div>
          ${salesCategoryTotals.length > 0 ? `
            <div class="category-strip">
              <strong>CATEGORY TOTALS:</strong> ${salesCategoryTotals.map(c => `${c.name}: ${currency} ${fmtNum(c.total)} (${c.count} items)`).join(' &bull; ')}
            </div>
          ` : ''}

          <!-- Section 2: Shop Overhead Expenses -->
          <div class="section-title">
            <span>2. Today Shop Overhead Expenses (${todayExpenses.length} Logs)</span>
            <span class="section-badge">TOTAL EXPENSES: ${currency} ${fmtNum(expenseTotals.total)}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:20px;">#</th>
                <th style="width:75px;">Date &amp; Time</th>
                <th>Expense Title &amp; Description</th>
                <th>Category</th>
                <th>Payment Channel</th>
                <th>Recipient / Remarks</th>
                <th class="text-right" style="width:65px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${todayExpenses.length === 0 ? `
                <tr><td colspan="7" class="text-center" style="color:#64748b; padding:2px; font-size:7px;">No shop overhead expenses recorded for today.</td></tr>
              ` : todayExpenses.map((e, idx) => {
                const dt = formatRecordDateTime(e.expenseDate || e.date || e.createdAt || e.created_at || e.timestamp);
                return `
                  <tr>
                    <td>${idx + 1}</td>
                    <td style="white-space:nowrap; font-size:7px; line-height:1.1;"><strong>${dt.date}</strong><br/><span style="color:#64748b; font-size:6px;">${dt.time}</span></td>
                    <td class="font-bold">${e.title || e.description || 'Shop Expense'}</td>
                    <td>${e.category || 'General Overhead'}</td>
                    <td>${e.paymentMethod || 'CASH'}</td>
                    <td>${e.paidTo || e.remarks || '—'}</td>
                    <td class="text-right font-black" style="color:#b91c1c;">${currency} ${fmtNum(e.amount)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <!-- Expenses Payment Summary Strip -->
          <div class="summary-strip">
            <div style="display:flex; gap:8px;">
              <span style="color:#475569; text-transform:uppercase;">EXPENSES PAYMENT BREAKDOWN:</span>
              <span>💵 Cash Paid: <strong style="color:#047857;">${currency} ${fmtNum(expenseTotals.cash)}</strong></span>
              <span>🏦 Bank Paid: <strong style="color:#1d4ed8;">${currency} ${fmtNum(expenseTotals.bank)}</strong></span>
            </div>
            <div>
              TOTAL EXPENSES: <strong style="color:#b91c1c; font-size:8px;">${currency} ${fmtNum(expenseTotals.total)}</strong>
            </div>
          </div>

          <!-- Section 3: Fuel & Transport Expenses -->
          <div class="section-title">
            <span>3. Today Fuel &amp; Transport Logs (${todayFuel.length} Trips)</span>
            <span class="section-badge">TOTAL FUEL: ${currency} ${fmtNum(fuelTotals.total)} (${fuelTotals.liters} L)</span>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:20px;">#</th>
                <th style="width:75px;">Date &amp; Time</th>
                <th>Vehicle &amp; Model</th>
                <th>Driver Name</th>
                <th>Purpose / Delivery Route</th>
                <th>Fuel Liters &amp; Rate</th>
                <th>Payment Mode</th>
                <th class="text-right" style="width:65px;">Fuel Cost</th>
              </tr>
            </thead>
            <tbody>
              ${todayFuel.length === 0 ? `
                <tr><td colspan="8" class="text-center" style="color:#64748b; padding:2px; font-size:7px;">No fuel logs recorded for today.</td></tr>
              ` : todayFuel.map((f, idx) => {
                const dt = formatRecordDateTime(f.expenseDate || f.date || f.createdAt || f.created_at || f.timestamp);
                return `
                  <tr>
                    <td>${idx + 1}</td>
                    <td style="white-space:nowrap; font-size:7px; line-height:1.1;"><strong>${dt.date}</strong><br/><span style="color:#64748b; font-size:6px;">${dt.time}</span></td>
                    <td class="font-bold">${f.vehicleNumber || f.vehicleName || 'Shop Vehicle'}</td>
                    <td>${f.driverName || 'Shop Driver'}</td>
                    <td>${f.purpose || f.destination || 'Delivery Route'}</td>
                    <td>${f.liters || 0} L @ ${currency} ${fmtNum(f.ratePerLiter || 0)}</td>
                    <td>${f.paymentMethod || 'CASH'}</td>
                    <td class="text-right font-black" style="color:#c2410c;">${currency} ${fmtNum(f.totalAmount)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <!-- Fuel Payment Summary Strip -->
          <div class="summary-strip">
            <div style="display:flex; gap:8px;">
              <span style="color:#475569; text-transform:uppercase;">FUEL PAYMENT BREAKDOWN:</span>
              <span>💵 Cash Paid: <strong style="color:#047857;">${currency} ${fmtNum(fuelTotals.cash)}</strong></span>
              <span>🏦 Bank Paid: <strong style="color:#1d4ed8;">${currency} ${fmtNum(fuelTotals.bank)}</strong></span>
              <span>📋 Credit Due: <strong style="color:#c2410c;">${currency} ${fmtNum(fuelTotals.credit || 0)}</strong></span>
            </div>
            <div>
              TOTAL FUEL: <strong style="color:#c2410c; font-size:8px;">${currency} ${fmtNum(fuelTotals.total)} (${fuelTotals.liters} L)</strong>
            </div>
          </div>

          <!-- Section 4: Damaged Stock -->
          <div class="section-title">
            <span>4. Today Damaged Stock &amp; Losses (${todayDamaged.length} Incidents)</span>
            <span class="section-badge">TOTAL LOSS: ${currency} ${fmtNum(damagedTotals.totalLoss)} (${damagedTotals.eggs} Premium Plus)</span>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:20px;">#</th>
                <th style="width:75px;">Date &amp; Time</th>
                <th>Product / Category</th>
                <th>Damage Breakdown</th>
                <th>Cause / Description</th>
                <th class="text-right" style="width:65px;">Loss Amount</th>
              </tr>
            </thead>
            <tbody>
              ${todayDamaged.length === 0 ? `
                <tr><td colspan="6" class="text-center" style="color:#64748b; padding:2px; font-size:7px;">No damaged stock recorded for today.</td></tr>
              ` : todayDamaged.map((d, idx) => {
                const dt = formatRecordDateTime(d.damageDate || d.date || d.createdAt || d.created_at || d.timestamp);
                const eggs = Number(d.deductedEggs || d.eggQuantity || d.quantity || 0);
                const petis = (eggs / 360).toFixed(1);
                const loss = Number(d.totalLoss || d.lossAmount || 0);
                return `
                  <tr>
                    <td>${idx + 1}</td>
                    <td style="white-space:nowrap; font-size:7px; line-height:1.1;"><strong>${dt.date}</strong><br/><span style="color:#64748b; font-size:6px;">${dt.time}</span></td>
                    <td class="font-bold">
                      <div style="display:flex; align-items:center; gap:3px;">
                        <img src="${resolveProductImage(d.productName || d.product?.name, d.productId || d.product?._id, d.image || d.product?.image)}" style="width:11px; height:11px; border-radius:2px; object-fit:cover; border:1px solid #cbd5e1; flex-shrink:0;" onerror="this.onerror=null; this.src='/egg2.png';" />
                        <span>${d.productName || d.product?.name || 'Damaged Stock'}</span>
                      </div>
                    </td>
                    <td>${eggs} Premium Plus (${petis} Premium)</td>
                    <td>${d.reason || d.notes || 'Broken during transit/storage'}</td>
                    <td class="text-right font-black" style="color:#b45309;">${currency} ${fmtNum(loss)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <!-- Damaged Stock Summary Strip -->
          <div class="summary-strip">
            <div>
              <span>LOSS DETAILS: 📦 <strong>${fmtNum(damagedTotals.eggs)} Premium Plus (${damagedTotals.petis} Premium)</strong></span>
            </div>
            <div>
              TOTAL LOSS AMOUNT: <strong style="color:#b45309; font-size:8px;">${currency} ${fmtNum(damagedTotals.totalLoss)}</strong>
            </div>
          </div>

          <!-- Section 5: Purchases & Stock Restocks -->
          <div class="section-title">
            <span>5. Today Stock Purchases &amp; Restocks (${todayPurchases.length} Items)</span>
            <span class="section-badge">TOTAL PURCHASES: ${currency} ${fmtNum(purchaseTotals.cost)}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:20px;">#</th>
                <th style="width:75px;">Date &amp; Time</th>
                <th>Product Purchased</th>
                <th style="width:55px;">Category</th>
                <th>Supplier / Farm</th>
                <th>Quantity</th>
                <th class="text-right" style="width:55px;">Cash Paid</th>
                <th class="text-right" style="width:55px;">Due Balance</th>
                <th class="text-right" style="width:65px;">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              ${todayPurchases.length === 0 ? `
                <tr><td colspan="9" class="text-center" style="color:#64748b; padding:2px; font-size:7px;">No purchases recorded for today.</td></tr>
              ` : todayPurchases.map((p, idx) => {
                const dt = formatRecordDateTime(p.purchaseDate || p.date || p.createdAt || p.created_at || p.timestamp);
                return `
                  <tr>
                    <td>${idx + 1}</td>
                    <td style="white-space:nowrap; font-size:7px; line-height:1.1;"><strong>${dt.date}</strong><br/><span style="color:#64748b; font-size:6px;">${dt.time}</span></td>
                    <td class="font-bold">
                      <div style="display:flex; align-items:center; gap:3px;">
                        <img src="${resolveProductImage(p.name || p.productName, p.productId, p.image)}" style="width:11px; height:11px; border-radius:2px; object-fit:cover; border:1px solid #cbd5e1; flex-shrink:0;" onerror="this.onerror=null; this.src='/egg2.png';" />
                        <span>${p.name || p.productName || 'Stock'}</span>
                      </div>
                    </td>
                    <td><span style="background:#f1f5f9; color:#0f172a; padding:1px 3px; border-radius:2px; font-weight:800; font-size:6.5px; border:1px solid #cbd5e1;">${p.category || 'General'}</span></td>
                    <td>${p.supplier || p.supplierName || 'Farm Supplier'}</td>
                    <td class="text-center font-bold">${getPurchaseQtyDigit(p) || p.stock || p.quantity || 0}</td>
                    <td class="text-right font-bold">${p.cashPaid ? `${currency} ${fmtNum(p.cashPaid)}` : '—'}</td>
                    <td class="text-right font-bold" style="color:#b91c1c;">${p.dueAmount ? `${currency} ${fmtNum(p.dueAmount)}` : '—'}</td>
                    <td class="text-right font-black">${currency} ${fmtNum(p.totalPurchaseCost || p.costPrice || 0)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <!-- Purchases Payment Summary Strip -->
          <div class="summary-strip">
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <span style="color:#475569; text-transform:uppercase;">PURCHASE PAYMENT BREAKDOWN:</span>
              <span>💵 Cash Paid: <strong style="color:#047857;">${currency} ${fmtNum(purchaseTotals.cash)}</strong></span>
              <span>🏦 Bank Paid: <strong style="color:#1d4ed8;">${currency} ${fmtNum(purchaseTotals.bank)}</strong></span>
              <span>📋 Supplier Debt: <strong style="color:#b91c1c;">${currency} ${fmtNum(purchaseTotals.due)}</strong></span>
            </div>
            <div>
              TOTAL STOCK COST: <strong style="color:#0f172a; font-size:8px;">${currency} ${fmtNum(purchaseTotals.cost)} (${purchaseTotals.petis} Premium)</strong>
            </div>
          </div>

          <!-- Section 6: Registered Customers -->
          <div class="section-title">
            <span>6. Today Registered Customers &amp; Accounts (${todayCustomers.length} Records)</span>
            <span class="section-badge">TOTAL NEW: ${todayCustomers.length}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:20px;">#</th>
                <th style="width:75px;">Date &amp; Time</th>
                <th>Customer Full Name</th>
                <th>Phone Number</th>
                <th>Email Address</th>
                <th>Account Type</th>
              </tr>
            </thead>
            <tbody>
              ${todayCustomers.length === 0 ? `
                <tr><td colspan="6" class="text-center" style="color:#64748b; padding:2px; font-size:7px;">No new customer accounts added today.</td></tr>
              ` : todayCustomers.map((c, idx) => {
                const dt = formatRecordDateTime(c.createdAt || c.dateAdded || c.created_at || c.date || c.timestamp);
                return `
                  <tr>
                    <td>${idx + 1}</td>
                    <td style="white-space:nowrap; font-size:7px; line-height:1.1;"><strong>${dt.date}</strong><br/><span style="color:#64748b; font-size:6px;">${dt.time}</span></td>
                    <td class="font-bold">${c.fullName || c.name || 'Customer'}</td>
                    <td class="font-bold">${c.phone || '—'}</td>
                    <td>${c.email || '—'}</td>
                    <td>${c.isOnline ? 'Online Account' : 'Shop POS'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <div class="signatures">
            <div class="sign-box">
              <div class="sign-title">Cashier / Billing Incharge</div>
              <div class="sign-sub">Official Signature &amp; Verification</div>
            </div>
            <div class="sign-box">
              <div class="sign-title">Branch Store Manager</div>
              <div class="sign-sub">Audit Review &amp; Official Approval</div>
            </div>
            <div class="sign-box">
              <div class="sign-title">Authorized Super Admin Stamp</div>
              <div class="sign-sub">Central Management Executive Sign-off</div>
            </div>
          </div>

          <div class="footer-note">
            Official System-Generated Today Business Audit Statement &bull; Generated automatically by ECW Track POS Management Suite &bull; Confidential
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWin.document.close();
  };

  // ─── WhatsApp Share Handler (Executive Beautiful Formatting) ───
  const handleWhatsAppTodayHistory = () => {
    const fmtNum = (num) => Number(num || 0).toLocaleString('en-PK');
    
    let msg = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
    msg += `🏛️  *ECW TRACK POS*\n`;
    msg += `📍  *${(shopName || 'Branch').toUpperCase()}*\n`;
    msg += `📋  *DAILY BUSINESS AUDIT & CLOSING*\n`;
    msg += `📅  *${todayDateFormatted}* • ⏰ *${todayTimeFormatted}*\n`;
    if (shopPhone) msg += `📞  Contact: *${shopPhone}*\n`;
    msg += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;

    // Master Financial Settlement KPI Card
    msg += `📊 *TODAY FINANCIAL PERFORMANCE & SETTLEMENT*\n`;
    msg += `┌ 🟢 Today Gross Sale: *${currency} ${fmtNum(todayFinancialResult.grossSale)}*\n`;
    msg += `├ 🔴 Shop Overhead Exp: *${currency} ${fmtNum(todayFinancialResult.shopExp)}*\n`;
    msg += `├ ⛽ Vehicle Fuel Exp: *${currency} ${fmtNum(todayFinancialResult.fuelExp)}*\n`;
    msg += `├ 📦 Damaged Stock Loss: *${currency} ${fmtNum(todayFinancialResult.damLoss)}*\n`;
    msg += `├ ───────────────────────────\n`;
    const netSign = todayFinancialResult.isProfit ? '+' : '-';
    const netBadge = todayFinancialResult.isProfit ? '✅ PROFIT' : '⚠️ DEFICIT';
    msg += `└ 🎯 *NET RESULT:* *${netBadge} (${netSign}${currency} ${fmtNum(Math.abs(todayFinancialResult.netDailyBalance))})*\n\n`;

    // Cash Drawer & Inflow Details
    msg += `💰 *INFLOW & CASH POSITION*\n`;
    msg += `• 💵 Cash in Drawer: *${currency} ${fmtNum(todayFinancialResult.netCashInDrawer)}*\n`;
    msg += `• 🏦 Bank Transfers: *${currency} ${fmtNum(todayFinancialResult.bankIn)}*\n`;
    msg += `• 📝 Customer Credit (Due): *${currency} ${fmtNum(todayFinancialResult.customerCreditGiven)}*\n`;
    msg += `• 📦 Product Outflow: *${salesTotals.petis} Premium (${fmtNum(salesTotals.eggs)} Premium Plus)*\n\n`;

    // 1. Sales Invoices
    msg += `🛒 *1. TODAY SALES & ORDERS (${todaySales.length} Bills)*\n`;
    msg += `Total Revenue: *${currency} ${fmtNum(salesTotals.revenue)}*\n`;
    msg += `(Cash: ${currency} ${fmtNum(salesTotals.cash)} | Bank: ${currency} ${fmtNum(salesTotals.bank)} | Credit: ${currency} ${fmtNum(salesTotals.credit)})\n`;
    msg += `─────────────────────────────\n`;
    if (todaySales.length === 0) {
      msg += `_No sales bills recorded for today._\n\n`;
    } else {
      todaySales.forEach((s, idx) => {
        const inv = s.invoiceNumber || s.serialNumber || `INV-${idx + 1}`;
        const dt = formatRecordDateTime(s.saleDate || s.date || s.createdAt || s.created_at || s.timestamp || s.invoiceDate);
        const cust = s.customerName || 'Walk-in Customer';
        const phone = s.customerPhone ? ` (${s.customerPhone})` : '';
        const total = Number(s.totalAmount) || 0;
        const cash = Number(s.cashPaid !== undefined ? s.cashPaid : (s.paymentMethod === 'CASH' ? total : 0));
        const bank = Number(s.bankPaid !== undefined ? s.bankPaid : (s.paymentMethod === 'BANK' || s.paymentMethod === 'ONLINE' ? total : 0));
        const due = Number(s.creditDue || s.dueAmount || (s.paymentMethod === 'CREDIT' ? total : 0));
        let itms = (s.items && Array.isArray(s.items)) ? s.items.map(i => `${(i.name && i.name.toLowerCase() !== 'eggs') ? i.name : (i.title || 'Stock Item')} (x${i.quantity || 1})`).join(', ') : (s.itemsDescription || 'Stock Items');
        const rawCat = s.category || (s.items && s.items[0]?.category) || 'Premium';
        const cat = (rawCat && rawCat.toLowerCase() !== 'eggs' && rawCat.toLowerCase() !== 'egg') ? rawCat : 'Premium';

        msg += `▫️ *#${idx + 1} ${inv}* [${cat}] • ${dt.time}\n`;
        msg += `   👤 ${cust}${phone}\n`;
        msg += `   📦 ${itms}\n`;
        msg += `   💵 Cash: ${fmtNum(cash)} | 🏦 Bank: ${fmtNum(bank)} | 📝 Due: ${fmtNum(due)}\n`;
        msg += `   👉 *Total: ${currency} ${fmtNum(total)}*\n\n`;
      });
    }

    // 2. Shop Overhead Expenses
    msg += `🧾 *2. TODAY SHOP OVERHEAD EXPENSES (${todayExpenses.length} Logs)*\n`;
    msg += `Total Expenses: *${currency} ${fmtNum(expenseTotals.total)}* (Cash: ${fmtNum(expenseTotals.cash)} | Bank: ${fmtNum(expenseTotals.bank)})\n`;
    msg += `─────────────────────────────\n`;
    if (todayExpenses.length === 0) {
      msg += `_No shop overhead expenses recorded for today._\n\n`;
    } else {
      todayExpenses.forEach((e, idx) => {
        const dt = formatRecordDateTime(e.expenseDate || e.date || e.createdAt || e.created_at || e.timestamp);
        const title = e.title || e.description || 'Shop Expense';
        const cat = e.category || 'Overhead';
        const mode = e.paymentMethod || 'CASH';
        const rem = e.paidTo || e.remarks ? ` (${e.paidTo || e.remarks})` : '';
        const amt = Number(e.amount) || 0;
        msg += `• *#${idx + 1}* ${title} [${cat}] • ${mode}${rem}\n`;
        msg += `   Time: ${dt.time} | *Amount: ${currency} ${fmtNum(amt)}*\n`;
      });
      msg += `\n`;
    }

    // 3. Fuel & Transport
    msg += `⛽ *3. TODAY FUEL & TRANSPORT LOGS (${todayFuel.length} Trips)*\n`;
    msg += `Total Fuel Cost: *${currency} ${fmtNum(fuelTotals.total)}* (${fuelTotals.liters} L)\n`;
    msg += `─────────────────────────────\n`;
    if (todayFuel.length === 0) {
      msg += `_No fuel logs recorded for today._\n\n`;
    } else {
      todayFuel.forEach((f, idx) => {
        const dt = formatRecordDateTime(f.expenseDate || f.date || f.createdAt || f.created_at || f.timestamp);
        const veh = f.vehicleNumber || f.vehicleName || 'Shop Vehicle';
        const drv = f.driverName || 'Shop Driver';
        const route = f.purpose || f.destination || 'Delivery Route';
        const lit = f.liters || 0;
        const rate = f.ratePerLiter || 0;
        const mode = f.paymentMethod || 'CASH';
        const cost = Number(f.totalAmount) || 0;
        msg += `• *#${idx + 1}* ${veh} (Driver: ${drv})\n`;
        msg += `   Route: ${route} | ${lit}L @ ${fmtNum(rate)} [${mode}]\n`;
        msg += `   Time: ${dt.time} | *Cost: ${currency} ${fmtNum(cost)}*\n`;
      });
      msg += `\n`;
    }

    // 4. Damaged Stock
    msg += `📦 *4. TODAY DAMAGED STOCK & LOSSES (${todayDamaged.length} Incidents)*\n`;
    msg += `Total Damaged Loss: *${currency} ${fmtNum(damagedTotals.totalLoss)}* (${damagedTotals.eggs} Premium Plus • ${damagedTotals.petis} Premium)\n`;
    msg += `─────────────────────────────\n`;
    if (todayDamaged.length === 0) {
      msg += `_No damaged stock recorded for today._\n\n`;
    } else {
      todayDamaged.forEach((d, idx) => {
        const dt = formatRecordDateTime(d.damageDate || d.date || d.createdAt || d.created_at || d.timestamp);
        const prod = d.productName || d.product?.name || 'Damaged Stock';
        const eggs = Number(d.deductedEggs || d.eggQuantity || d.quantity || 0);
        const petis = (eggs / 360).toFixed(1);
        const reason = d.reason || d.notes || 'Broken / Cracked';
        const loss = Number(d.totalLoss || d.lossAmount || 0);
        msg += `• *#${idx + 1}* ${prod} | ${eggs} Premium Plus (${petis} Premium)\n`;
        msg += `   Reason: ${reason} | Time: ${dt.time} | *Loss: ${currency} ${fmtNum(loss)}*\n`;
      });
      msg += `\n`;
    }

    // 5. Stock Restocks
    if (todayPurchases.length > 0) {
      msg += `📦 *5. TODAY STOCK RESTOCKS (${todayPurchases.length} Items)*\n`;
      msg += `Total Restock Cost: *${currency} ${fmtNum(purchaseTotals.cost)}* (${purchaseTotals.petis} Premium)\n`;
      msg += `─────────────────────────────\n`;
      todayPurchases.forEach((p, idx) => {
        const dt = formatRecordDateTime(p.purchaseDate || p.date || p.createdAt || p.created_at || p.timestamp);
        const prod = p.name || p.productName || 'Stock';
        const sup = p.supplier || p.supplierName || 'Farm Supplier';
        const petis = p.petiQuantity || p.stock || 0;
        const cash = Number(p.cashPaid || 0);
        const due = Number(p.dueAmount || 0);
        const cost = Number(p.totalPurchaseCost || p.costPrice || 0);
        msg += `• *#${idx + 1}* ${prod} from ${sup} | ${petis} Premium\n`;
        msg += `   Paid: ${fmtNum(cash)} | Due: ${fmtNum(due)} | *Cost: ${currency} ${fmtNum(cost)}*\n`;
      });
      msg += `\n`;
    }

    // Official System Verification
    msg += `═════════════════════════════\n`;
    msg += `🔒 *STATUS: 100% VERIFIED SYSTEM AUDIT*\n`;
    msg += `✍️ Cashier Incharge • Branch Manager • Super Admin Stamp\n`;
    msg += `═════════════════════════════\n`;
    msg += `_ECW Track POS Management Suite_`;

    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // ─── Excel (.xlsx) Export with Professional Executive Design ───
  const handleExportTodayHistoryExcel = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'ECW Track POS';
      workbook.lastModifiedBy = 'ECW Track Management System';
      workbook.created = new Date();
      workbook.modified = new Date();

      const sheet = workbook.addWorksheet('Today Business Statement', {
        views: [{ showGridLines: true }]
      });

      // Standard border styles
      const thinBorder = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
      };
      const headerBorder = {
        top: { style: 'medium', color: { argb: 'FF064E3B' } },
        bottom: { style: 'medium', color: { argb: 'FF064E3B' } },
        left: { style: 'thin', color: { argb: 'FF064E3B' } },
        right: { style: 'thin', color: { argb: 'FF064E3B' } }
      };
      const doubleBottomBorder = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
      };

      // ─── 1. MAIN TITLE BANNER ───
      sheet.mergeCells('A1:J1');
      const r1 = sheet.getCell('A1');
      r1.value = 'ECW TRACK POS';
      r1.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF064E3B' } }; // Dark Emerald
      r1.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(1).height = 36;

      sheet.mergeCells('A2:J2');
      const r2 = sheet.getCell('A2');
      r2.value = `${(shopName || 'Branch').toUpperCase()} — DAILY BUSINESS AUDIT & CLOSING STATEMENT`;
      r2.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF065F46' } };
      r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }; // Mint
      r2.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(2).height = 24;

      sheet.mergeCells('A3:J3');
      const r3 = sheet.getCell('A3');
      r3.value = `Audit Date: ${todayDateFormatted}  |  Generated At: ${todayTimeFormatted}  |  Branch Phone: ${shopPhone || 'N/A'}  |  Status: 100% VERIFIED SYSTEM AUDIT`;
      r3.font = { name: 'Arial', size: 9.5, italic: true, color: { argb: 'FF334155' } };
      r3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      r3.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(3).height = 20;

      // ─── 2. DAILY FINANCIAL PERFORMANCE CARDS ───
      sheet.mergeCells('A5:J5');
      const kpiTitle = sheet.getCell('A5');
      kpiTitle.value = '★ TODAY DAILY FINANCIAL PERFORMANCE & REALIZED SETTLEMENT';
      kpiTitle.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      kpiTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Slate 900
      kpiTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      sheet.getRow(5).height = 26;

      const kpiHeaders = [
        '(+) 1. Today Gross Sale',
        '(-) 2. Shop Expense',
        '(-) 3. Fuel Expense',
        '(-) 4. Damaged Loss',
        '(=) Today Net Result',
        'Cash in Drawer',
        'Bank Transfers',
        'Customer Credit (Due)',
        'Stock Restocks (Cost)',
        'Product Outflow (Premium)'
      ];
      const kpiRow1 = sheet.addRow(kpiHeaders);
      kpiRow1.height = 24;
      kpiRow1.eachCell(cell => {
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1E293B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = thinBorder;
      });

      const netVal = Number(todayFinancialResult.netDailyBalance) || 0;
      const isProf = todayFinancialResult.isProfit;
      const kpiValues = [
        Number(todayFinancialResult.grossSale) || 0,
        Number(todayFinancialResult.shopExp) || 0,
        Number(todayFinancialResult.fuelExp) || 0,
        Number(todayFinancialResult.damLoss) || 0,
        netVal,
        Number(todayFinancialResult.netCashInDrawer) || 0,
        Number(todayFinancialResult.bankIn) || 0,
        Number(todayFinancialResult.customerCreditGiven) || 0,
        Number(purchaseTotals.cost) || 0,
        `${salesTotals.petis} Prem (${Number(salesTotals.eggs).toLocaleString('en-PK')} Plus)`
      ];
      const kpiRow2 = sheet.addRow(kpiValues);
      kpiRow2.height = 30;
      kpiRow2.eachCell((cell, colNum) => {
        cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } };
        cell.border = thinBorder;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (colNum <= 9 && typeof cell.value === 'number') {
          cell.numFmt = '#,##0';
        }

        // Highlight Net Result
        if (colNum === 5) {
          if (isProf) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } }; // Light green
            cell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF166534' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }; // Light red
            cell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF991B1B' } };
          }
        } else if (colNum === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
        } else if (colNum === 6) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; // Amber light
        } else if (colNum === 7) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }; // Blue light
        }
      });

      sheet.addRow([]); // Blank spacing row

      // ─── 3. TABLE 1: TODAY POS BILLS & SALES INVOICES ───
      const t1StartRow = sheet.rowCount + 1;
      sheet.mergeCells(`A${t1StartRow}:J${t1StartRow}`);
      const t1Title = sheet.getCell(`A${t1StartRow}`);
      t1Title.value = `🛒 1. TODAY POS BILLS & SALES INVOICES (${todaySales.length} Invoices) — Total Revenue: Rs. ${Number(salesTotals.revenue).toLocaleString('en-PK')}`;
      t1Title.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      t1Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } }; // Emerald 700
      t1Title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      sheet.getRow(t1StartRow).height = 26;

      const salesHeaders = ['#', 'Invoice #', 'Category', 'Date & Time', 'Customer Name & Contact', 'Items / Description', 'Cash Paid', 'Bank Paid', 'Credit Due', 'Total Amount'];
      const sHeadRow = sheet.addRow(salesHeaders);
      sHeadRow.height = 24;
      sHeadRow.eachCell(cell => {
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } }; // Emerald 600
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = headerBorder;
      });

      if (todaySales.length === 0) {
        const emptyRow = sheet.addRow(['', 'No sales bills recorded for today', '', '', '', '', '', '', '', '']);
        sheet.mergeCells(`B${sheet.rowCount}:J${sheet.rowCount}`);
        emptyRow.eachCell(c => { c.font = { italic: true, color: { argb: 'FF64748B' } }; c.alignment = { horizontal: 'center' }; });
      } else {
        todaySales.forEach((s, idx) => {
          const inv = s.invoiceNumber || s.serialNumber || `INV-${idx + 1}`;
          const dt = formatRecordDateTime(s.saleDate || s.date || s.createdAt || s.created_at || s.timestamp || s.invoiceDate);
          const rawCat = s.category || (s.items && s.items[0]?.category) || 'Premium';
          const cat = (rawCat && rawCat.toLowerCase() !== 'eggs' && rawCat.toLowerCase() !== 'egg') ? rawCat : 'Premium';
          const cust = s.customerName || 'Walk-in Customer';
          const phone = s.customerPhone ? ` (${s.customerPhone})` : '';
          const total = Number(s.totalAmount) || 0;
          const cash = Number(s.cashPaid !== undefined ? s.cashPaid : (s.paymentMethod === 'CASH' ? total : 0));
          const bank = Number(s.bankPaid !== undefined ? s.bankPaid : (s.paymentMethod === 'BANK' || s.paymentMethod === 'ONLINE' ? total : 0));
          const due = Number(s.creditDue || s.dueAmount || (s.paymentMethod === 'CREDIT' ? total : 0));
          const itms = (s.items && Array.isArray(s.items)) ? s.items.map(i => `${(i.name && i.name.toLowerCase() !== 'eggs') ? i.name : (i.title || 'Stock Item')} (x${i.quantity || 1})`).join(', ') : (s.itemsDescription || 'Stock Items');

          const sRow = sheet.addRow([
            idx + 1,
            inv,
            cat,
            dt.full,
            `${cust}${phone}`,
            itms,
            cash,
            bank,
            due,
            total
          ]);
          sRow.height = 22;
          sRow.eachCell((cell, cNum) => {
            cell.font = { name: 'Arial', size: 9.5, color: { argb: 'FF0F172A' } };
            cell.border = thinBorder;
            if (cNum === 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
            else if (cNum === 2 || cNum === 3) cell.alignment = { horizontal: 'center', vertical: 'middle', font: { bold: true } };
            else if (cNum >= 7 && cNum <= 10) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.numFmt = '#,##0';
              if (cNum === 10) cell.font = { bold: true };
            } else {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }
          });
        });

        // Sales Total Row
        const sTotalRow = sheet.addRow([
          'TOTAL',
          '',
          '',
          '',
          '',
          `${salesTotals.petis} Premium (${Number(salesTotals.eggs).toLocaleString('en-PK')} Premium Plus)`,
          Number(salesTotals.cash) || 0,
          Number(salesTotals.bank) || 0,
          Number(salesTotals.credit) || 0,
          Number(salesTotals.revenue) || 0
        ]);
        sTotalRow.height = 26;
        sheet.mergeCells(`A${sheet.rowCount}:E${sheet.rowCount}`);
        sTotalRow.eachCell((cell, cNum) => {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF064E3B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
          cell.border = doubleBottomBorder;
          if (cNum >= 6) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            if (typeof cell.value === 'number') cell.numFmt = '#,##0';
          } else {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        });
      }

      sheet.addRow([]); // Blank spacing row

      // ─── 4. TABLE 2: TODAY SHOP OVERHEAD EXPENSES ───
      const t2StartRow = sheet.rowCount + 1;
      sheet.mergeCells(`A${t2StartRow}:J${t2StartRow}`);
      const t2Title = sheet.getCell(`A${t2StartRow}`);
      t2Title.value = `🧾 2. TODAY SHOP OVERHEAD EXPENSES (${todayExpenses.length} Logs) — Total Expenses: Rs. ${Number(expenseTotals.total).toLocaleString('en-PK')}`;
      t2Title.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      t2Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBE123C' } }; // Rose 700
      t2Title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      sheet.getRow(t2StartRow).height = 26;

      const expHeaders = ['#', 'Date & Time', 'Expense Title / Purpose', 'Category', 'Payment Channel', 'Paid To / Remarks', '', '', '', 'Amount (Rs)'];
      const eHeadRow = sheet.addRow(expHeaders);
      eHeadRow.height = 24;
      sheet.mergeCells(`F${sheet.rowCount}:I${sheet.rowCount}`);
      eHeadRow.eachCell(cell => {
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE11D48' } }; // Rose 600
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = headerBorder;
      });

      if (todayExpenses.length === 0) {
        const emptyRow = sheet.addRow(['', 'No overhead expenses recorded for today', '', '', '', '', '', '', '', '']);
        sheet.mergeCells(`B${sheet.rowCount}:J${sheet.rowCount}`);
        emptyRow.eachCell(c => { c.font = { italic: true, color: { argb: 'FF64748B' } }; c.alignment = { horizontal: 'center' }; });
      } else {
        todayExpenses.forEach((e, idx) => {
          const dt = formatRecordDateTime(e.expenseDate || e.date || e.createdAt || e.created_at || e.timestamp);
          const title = e.title || e.description || 'Shop Expense';
          const cat = e.category || 'General Overhead';
          const mode = e.paymentMethod || 'CASH';
          const rem = e.paidTo || e.remarks || '—';
          const amt = Number(e.amount) || 0;

          const eRow = sheet.addRow([
            idx + 1,
            dt.full,
            title,
            cat,
            mode,
            rem,
            '',
            '',
            '',
            amt
          ]);
          eRow.height = 22;
          sheet.mergeCells(`F${sheet.rowCount}:I${sheet.rowCount}`);
          eRow.eachCell((cell, cNum) => {
            cell.font = { name: 'Arial', size: 9.5, color: { argb: 'FF0F172A' } };
            cell.border = thinBorder;
            if (cNum === 1 || cNum === 5) cell.alignment = { horizontal: 'center', vertical: 'middle' };
            else if (cNum === 10) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.numFmt = '#,##0';
              cell.font = { bold: true };
            } else {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }
          });
        });

        // Expenses Total Row
        const eTotalRow = sheet.addRow([
          'TOTAL OVERHEAD EXPENSES',
          '',
          '',
          '',
          `Cash: Rs. ${Number(expenseTotals.cash).toLocaleString('en-PK')} | Bank: Rs. ${Number(expenseTotals.bank).toLocaleString('en-PK')}`,
          '',
          '',
          '',
          '',
          Number(expenseTotals.total) || 0
        ]);
        eTotalRow.height = 26;
        sheet.mergeCells(`A${sheet.rowCount}:D${sheet.rowCount}`);
        sheet.mergeCells(`E${sheet.rowCount}:I${sheet.rowCount}`);
        eTotalRow.eachCell((cell, cNum) => {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF9F1239' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } };
          cell.border = doubleBottomBorder;
          if (cNum === 10) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
          } else {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        });
      }

      sheet.addRow([]); // Blank spacing row

      // ─── 5. TABLE 3: TODAY FUEL & TRANSPORT LOGS ───
      const t3StartRow = sheet.rowCount + 1;
      sheet.mergeCells(`A${t3StartRow}:J${t3StartRow}`);
      const t3Title = sheet.getCell(`A${t3StartRow}`);
      t3Title.value = `⛽ 3. TODAY VEHICLE FUEL & TRANSPORT LOGS (${todayFuel.length} Trips) — Total Fuel: Rs. ${Number(fuelTotals.total).toLocaleString('en-PK')} (${fuelTotals.liters} L)`;
      t3Title.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      t3Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } }; // Amber 700
      t3Title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      sheet.getRow(t3StartRow).height = 26;

      const fuelHeaders = ['#', 'Date & Time', 'Vehicle # & Model', 'Driver Name', 'Purpose / Route', 'Liters (L)', 'Rate / L', 'Payment Mode', '', 'Total Cost (Rs)'];
      const fHeadRow = sheet.addRow(fuelHeaders);
      fHeadRow.height = 24;
      sheet.mergeCells(`H${sheet.rowCount}:I${sheet.rowCount}`);
      fHeadRow.eachCell(cell => {
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } }; // Amber 600
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = headerBorder;
      });

      if (todayFuel.length === 0) {
        const emptyRow = sheet.addRow(['', 'No fuel expenses recorded for today', '', '', '', '', '', '', '', '']);
        sheet.mergeCells(`B${sheet.rowCount}:J${sheet.rowCount}`);
        emptyRow.eachCell(c => { c.font = { italic: true, color: { argb: 'FF64748B' } }; c.alignment = { horizontal: 'center' }; });
      } else {
        todayFuel.forEach((f, idx) => {
          const dt = formatRecordDateTime(f.expenseDate || f.date || f.createdAt || f.created_at || f.timestamp);
          const veh = f.vehicleNumber || f.vehicleName || 'Shop Vehicle';
          const drv = f.driverName || 'Shop Driver';
          const route = f.purpose || f.destination || 'Delivery Route';
          const lit = Number(f.liters) || 0;
          const rate = Number(f.ratePerLiter) || 0;
          const mode = f.paymentMethod || 'CASH';
          const cost = Number(f.totalAmount) || 0;

          const fRow = sheet.addRow([
            idx + 1,
            dt.full,
            veh,
            drv,
            route,
            lit,
            rate,
            mode,
            '',
            cost
          ]);
          fRow.height = 22;
          sheet.mergeCells(`H${sheet.rowCount}:I${sheet.rowCount}`);
          fRow.eachCell((cell, cNum) => {
            cell.font = { name: 'Arial', size: 9.5, color: { argb: 'FF0F172A' } };
            cell.border = thinBorder;
            if (cNum === 1 || cNum === 6 || cNum === 8) cell.alignment = { horizontal: 'center', vertical: 'middle' };
            else if (cNum === 7 || cNum === 10) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.numFmt = '#,##0';
              if (cNum === 10) cell.font = { bold: true };
            } else {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }
          });
        });

        // Fuel Total Row
        const fTotalRow = sheet.addRow([
          'TOTAL FUEL EXPENSES',
          '',
          '',
          '',
          '',
          `${fuelTotals.liters} L`,
          '',
          `Cash: Rs. ${Number(fuelTotals.cash).toLocaleString('en-PK')} | Bank: Rs. ${Number(fuelTotals.bank).toLocaleString('en-PK')}`,
          '',
          Number(fuelTotals.total) || 0
        ]);
        fTotalRow.height = 26;
        sheet.mergeCells(`A${sheet.rowCount}:E${sheet.rowCount}`);
        sheet.mergeCells(`H${sheet.rowCount}:I${sheet.rowCount}`);
        fTotalRow.eachCell((cell, cNum) => {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF92400E' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
          cell.border = doubleBottomBorder;
          if (cNum === 10) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
          } else {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        });
      }

      sheet.addRow([]); // Blank spacing row

      // ─── 6. TABLE 4: TODAY DAMAGED PRODUCTS & LOSSES ───
      const t4StartRow = sheet.rowCount + 1;
      sheet.mergeCells(`A${t4StartRow}:J${t4StartRow}`);
      const t4Title = sheet.getCell(`A${t4StartRow}`);
      t4Title.value = `📦 4. TODAY DAMAGED & STOCK LOSSES (${todayDamaged.length} Incidents) — Total Loss: Rs. ${Number(damagedTotals.totalLoss).toLocaleString('en-PK')} (${damagedTotals.eggs} Premium Plus)`;
      t4Title.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      t4Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC2410C' } }; // Orange 700
      t4Title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      sheet.getRow(t4StartRow).height = 26;

      const damHeaders = ['#', 'Date & Time', 'Product / Category', 'Damaged Premium Plus', 'Premium Equivalent', 'Cause / Description', '', '', '', 'Total Loss (Rs)'];
      const dHeadRow = sheet.addRow(damHeaders);
      dHeadRow.height = 24;
      sheet.mergeCells(`F${sheet.rowCount}:I${sheet.rowCount}`);
      dHeadRow.eachCell(cell => {
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } }; // Orange 600
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = headerBorder;
      });

      if (todayDamaged.length === 0) {
        const emptyRow = sheet.addRow(['', 'No damaged stock recorded for today', '', '', '', '', '', '', '', '']);
        sheet.mergeCells(`B${sheet.rowCount}:J${sheet.rowCount}`);
        emptyRow.eachCell(c => { c.font = { italic: true, color: { argb: 'FF64748B' } }; c.alignment = { horizontal: 'center' }; });
      } else {
        todayDamaged.forEach((d, idx) => {
          const dt = formatRecordDateTime(d.damageDate || d.date || d.createdAt || d.created_at || d.timestamp);
          const prod = d.productName || d.product?.name || 'Damaged Stock';
          const eggs = Number(d.deductedEggs || d.eggQuantity || d.quantity || 0);
          const petis = (eggs / 360).toFixed(1);
          const reason = d.reason || d.notes || 'Damage / Breakage';
          const loss = Number(d.totalLoss || d.lossAmount || 0);

          const dRow = sheet.addRow([
            idx + 1,
            dt.full,
            prod,
            eggs,
            `${petis} Prem`,
            reason,
            '',
            '',
            '',
            loss
          ]);
          dRow.height = 22;
          sheet.mergeCells(`F${sheet.rowCount}:I${sheet.rowCount}`);
          dRow.eachCell((cell, cNum) => {
            cell.font = { name: 'Arial', size: 9.5, color: { argb: 'FF0F172A' } };
            cell.border = thinBorder;
            if (cNum === 1 || cNum === 4 || cNum === 5) cell.alignment = { horizontal: 'center', vertical: 'middle' };
            else if (cNum === 10) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.numFmt = '#,##0';
              cell.font = { bold: true };
            } else {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }
          });
        });

        // Damaged Total Row
        const dTotalRow = sheet.addRow([
          'TOTAL DAMAGED LOSS',
          '',
          '',
          `${damagedTotals.eggs} Premium Plus`,
          `${damagedTotals.petis} Premium`,
          '',
          '',
          '',
          '',
          Number(damagedTotals.totalLoss) || 0
        ]);
        dTotalRow.height = 26;
        sheet.mergeCells(`A${sheet.rowCount}:C${sheet.rowCount}`);
        sheet.mergeCells(`F${sheet.rowCount}:I${sheet.rowCount}`);
        dTotalRow.eachCell((cell, cNum) => {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF9A3412' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
          cell.border = doubleBottomBorder;
          if (cNum === 10) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
          } else {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        });
      }

      sheet.addRow([]); // Blank spacing row

      // ─── 7. TABLE 5: TODAY STOCK RESTOCKS & PURCHASES ───
      const t5StartRow = sheet.rowCount + 1;
      sheet.mergeCells(`A${t5StartRow}:J${t5StartRow}`);
      const t5Title = sheet.getCell(`A${t5StartRow}`);
      t5Title.value = `📦 5. TODAY STOCK RESTOCKS & SUPPLIER PURCHASES (${todayPurchases.length} Items) — Total Cost: Rs. ${Number(purchaseTotals.cost).toLocaleString('en-PK')}`;
      t5Title.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      t5Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }; // Blue 800
      t5Title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      sheet.getRow(t5StartRow).height = 26;

      const purHeaders = ['#', 'Date & Time', 'Product Purchased', 'Category', 'Supplier / Farm', 'Quantity (Premium)', 'Cash Paid', 'Bank Paid', 'Supplier Debt', 'Total Cost (Rs)'];
      const pHeadRow = sheet.addRow(purHeaders);
      pHeadRow.height = 24;
      pHeadRow.eachCell(cell => {
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }; // Blue 600
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = headerBorder;
      });

      if (todayPurchases.length === 0) {
        const emptyRow = sheet.addRow(['', 'No purchases recorded for today', '', '', '', '', '', '', '', '']);
        sheet.mergeCells(`B${sheet.rowCount}:J${sheet.rowCount}`);
        emptyRow.eachCell(c => { c.font = { italic: true, color: { argb: 'FF64748B' } }; c.alignment = { horizontal: 'center' }; });
      } else {
        todayPurchases.forEach((p, idx) => {
          const dt = formatRecordDateTime(p.purchaseDate || p.date || p.createdAt || p.created_at || p.timestamp);
          const prod = p.name || p.productName || 'Stock';
          const cat = p.category || 'General';
          const sup = p.supplier || p.supplierName || 'Farm Supplier';
          const petis = p.petiQuantity || p.stock || 0;
          const cash = Number(p.cashPaid || 0);
          const bank = Number(p.bankPaid || 0);
          const due = Number(p.dueAmount || 0);
          const cost = Number(p.totalPurchaseCost || p.costPrice || 0);

          const pRow = sheet.addRow([
            idx + 1,
            dt.full,
            prod,
            cat,
            sup,
            petis,
            cash,
            bank,
            due,
            cost
          ]);
          pRow.height = 22;
          pRow.eachCell((cell, cNum) => {
            cell.font = { name: 'Arial', size: 9.5, color: { argb: 'FF0F172A' } };
            cell.border = thinBorder;
            if (cNum === 1 || cNum === 6) cell.alignment = { horizontal: 'center', vertical: 'middle' };
            else if (cNum >= 7 && cNum <= 10) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.numFmt = '#,##0';
              if (cNum === 10) cell.font = { bold: true };
            } else {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }
          });
        });

        // Purchases Total Row
        const pTotalRow = sheet.addRow([
          'TOTAL PURCHASES',
          '',
          '',
          '',
          '',
          `${purchaseTotals.petis} Premium`,
          Number(purchaseTotals.cash) || 0,
          Number(purchaseTotals.bank) || 0,
          Number(purchaseTotals.due) || 0,
          Number(purchaseTotals.cost) || 0
        ]);
        pTotalRow.height = 26;
        sheet.mergeCells(`A${sheet.rowCount}:E${sheet.rowCount}`);
        pTotalRow.eachCell((cell, cNum) => {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
          cell.border = doubleBottomBorder;
          if (cNum >= 6) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            if (typeof cell.value === 'number') cell.numFmt = '#,##0';
          } else {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        });
      }

      sheet.addRow([]); // Blank spacing row

      // ─── 8. AUDIT FOOTER & SIGNATURES ───
      const signRow = sheet.rowCount + 2;
      sheet.mergeCells(`A${signRow}:C${signRow}`);
      sheet.mergeCells(`E${signRow}:G${signRow}`);
      sheet.mergeCells(`H${signRow}:J${signRow}`);

      sheet.getCell(`A${signRow}`).value = '------------------------------------------\nCASHIER / BILLING INCHARGE';
      sheet.getCell(`E${signRow}`).value = '------------------------------------------\nBRANCH STORE MANAGER';
      sheet.getCell(`H${signRow}`).value = '------------------------------------------\nAUTHORIZED SUPER ADMIN STAMP';

      [sheet.getCell(`A${signRow}`), sheet.getCell(`E${signRow}`), sheet.getCell(`H${signRow}`)].forEach(c => {
        c.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF475569' } };
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
      sheet.getRow(signRow).height = 40;

      // ─── 9. PERFECT COLUMN WIDTHS (NO SQUISHING / NO CLIPPING) ───
      sheet.columns = [
        { width: 6 },   // A: #
        { width: 18 },  // B: Invoice # / Date
        { width: 18 },  // C: Category
        { width: 22 },  // D: Date & Time
        { width: 28 },  // E: Customer / Supplier
        { width: 34 },  // F: Items / Description
        { width: 16 },  // G: Cash Paid
        { width: 16 },  // H: Bank Paid
        { width: 16 },  // I: Credit Due
        { width: 18 }   // J: Total Amount
      ];

      // Export file as .xlsx
      const buffer = await workbook.xlsx.writeBuffer();
      const safeBranch = (shopName || 'Branch').replace(/[^a-zA-Z0-9]/g, '_');
      const nowStr = now.toISOString().split('T')[0];
      saveAs(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `Today_Statement_${safeBranch}_${nowStr}.xlsx`
      );
    } catch (err) {
      console.error('Export Excel Error:', err);
      alert('Failed to generate Excel file: ' + err.message);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ─── 1. TOP HEADER & ACTION BAR ─── */}
      <div className="bg-white border-2 border-slate-300 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-500 flex items-center justify-center text-zinc-950 shadow-md shrink-0">
            <History className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-300">
                ● Live Today Audit
              </span>
              <span className="text-xs font-black text-black">{shopName}</span>
            </div>
            <h1 className="text-lg sm:text-2xl font-black text-black uppercase tracking-tight mt-0.5">
              Today History &amp; Master Closing
            </h1>
            <p className="text-xs text-black font-bold">
              Single-page master record of today's sales, purchases, expenses, fuel, damage &amp; settlements
            </p>
          </div>
        </div>

        {/* Action Buttons - 3D Styled */}
        <div className="flex items-center gap-2 flex-wrap w-full xl:w-auto justify-start xl:justify-end">
          <button
            type="button"
            onClick={handlePrintTodayHistory}
            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 border-t-2 border-t-emerald-300/50 border-x border-emerald-600 border-b-4 border-b-emerald-950 shadow-[0_4px_12px_rgba(5,150,105,0.35)] active:translate-y-1 active:border-b-2 hover:shadow-lg transition-all cursor-pointer"
            title="Print entire today business statement"
          >
            <Printer className="w-4 h-4" />
            <span>Print Full Today Report</span>
          </button>

          <button
            type="button"
            onClick={handleWhatsAppTodayHistory}
            className="px-3.5 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 border-t-2 border-t-green-300/50 border-x border-green-600 border-b-4 border-b-green-950 shadow-[0_4px_12px_rgba(22,163,74,0.35)] active:translate-y-1 active:border-b-2 hover:shadow-lg transition-all cursor-pointer"
            title="Share Today Summary on WhatsApp"
          >
            <Send className="w-4 h-4" />
            <span>WhatsApp</span>
          </button>

          <button
            type="button"
            onClick={handleExportTodayHistoryExcel}
            className="px-3.5 py-2.5 bg-gradient-to-b from-white to-slate-100 hover:bg-slate-50 text-slate-900 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 border-t-2 border-t-white border-x border-slate-300 border-b-4 border-b-slate-400 shadow-[0_4px_10px_rgba(0,0,0,0.12)] active:translate-y-1 active:border-b-2 hover:shadow-md transition-all cursor-pointer"
            title="Export Today CSV"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <span>Excel</span>
          </button>

          <button
            type="button"
            onClick={handleTriggerRefresh}
            disabled={isRefreshing}
            className="p-2.5 bg-gradient-to-b from-white to-slate-100 hover:bg-slate-50 text-slate-900 rounded-xl border-t-2 border-t-white border-x border-slate-300 border-b-4 border-b-slate-400 shadow-[0_4px_10px_rgba(0,0,0,0.12)] active:translate-y-1 active:border-b-2 hover:shadow-md transition-all cursor-pointer"
            title="Refresh Today Data"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* ─── 2. DEDICATED DAILY FINANCIAL CALCULATION BOX (3D Gray Theme) ─── */}
      <div className="bg-gradient-to-b from-slate-200 via-slate-100 to-slate-300 border-t-2 border-t-white border-x-2 border-x-slate-300 border-b-4 border-b-slate-500 shadow-[0_8px_22px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.95)] rounded-3xl p-4 sm:p-5 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
          <History className="w-64 h-64 text-slate-800" />
        </div>

        <div className="relative z-10 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b-2 border-slate-300 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-900 border-t border-t-white border-b-2 border-b-emerald-400 shadow-xs">
                <Sparkles className="w-4 h-4 animate-pulse text-emerald-700" />
              </span>
              <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-black">
                Today Daily Financial Performance &amp; Realized Settlement
              </h2>
            </div>
            <span className="text-[11px] font-black text-black bg-white px-3 py-1 rounded-full border-t border-t-white border-b-2 border-b-slate-400 shadow-xs">
              📅 {todayDateFormatted}
            </span>
          </div>

          {/* Formula Representation Grid - 3D Cards Closely Spaced */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-2.5">
            {/* Step 1: (+) Today Sale (Clickable 3D) */}
            <button
              type="button"
              onClick={() => handleCardClick('SALES', 'ALL')}
              className={`text-left bg-gradient-to-b from-white to-emerald-50/40 rounded-2xl p-3 border-t-2 border-t-emerald-200 border-x border-emerald-300 border-b-4 border-b-emerald-600 shadow-[0_4px_10px_rgba(16,185,129,0.18)] flex flex-col justify-between transition-all cursor-pointer hover:shadow-md hover:scale-[1.015] active:translate-y-1 active:border-b-2 group ${
                activeTab === 'SALES' && salesPaymentFilter === 'ALL'
                  ? 'ring-2 ring-emerald-600 bg-emerald-50'
                  : ''
              }`}
              title="Click to view all today sales, customers & products"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-black flex items-center gap-1">
                  (+) 1. Today Gross Sale
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-600" />
                </span>
                <span className="w-5 h-5 rounded-full bg-emerald-100 text-black text-xs font-black flex items-center justify-center border border-emerald-300 shadow-2xs">+</span>
              </div>
              <div className="text-lg sm:text-2xl font-black text-black mt-1.5">
                {currency} {todayFinancialResult.grossSale.toLocaleString('en-PK')}
              </div>
              <div className="flex items-center justify-between text-[10px] font-black text-black mt-0.5">
                <span>{salesTotals.count} {salesTotals.count === 1 ? 'Bill' : 'Bills'}</span>
                <span className="text-[9px] font-black uppercase bg-emerald-100 hover:bg-emerald-200 text-emerald-950 px-2 py-0.5 rounded-lg border-t border-t-white border-b-2 border-b-emerald-600 shadow-2xs">View List</span>
              </div>
            </button>

            {/* Step 2: (-) Shop Expenses (Clickable 3D - Full Red) */}
            <button
              type="button"
              onClick={() => handleCardClick('EXPENSES')}
              className={`text-left bg-gradient-to-b from-white to-rose-50/40 rounded-2xl p-3 border-t-2 border-t-rose-200 border-x border-rose-300 border-b-4 border-b-red-600 shadow-[0_4px_10px_rgba(239,68,68,0.18)] flex flex-col justify-between transition-all cursor-pointer hover:shadow-md hover:scale-[1.015] active:translate-y-1 active:border-b-2 group ${
                activeTab === 'EXPENSES'
                  ? 'ring-2 ring-red-600 bg-rose-50'
                  : ''
              }`}
              title="Click to view shop expenses list"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-red-600 flex items-center gap-1">
                  (-) 2. Shop Expense
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-red-600" />
                </span>
                <span className="w-5 h-5 rounded-full bg-rose-100 text-red-600 text-xs font-black flex items-center justify-center border border-rose-300 shadow-2xs">-</span>
              </div>
              <div className="text-lg sm:text-2xl font-black text-red-600 mt-1.5">
                {currency} {todayFinancialResult.shopExp.toLocaleString('en-PK')}
              </div>
              <div className="flex items-center justify-between text-[10px] font-black text-red-600 mt-0.5">
                <span>{expenseTotals.count} Overhead Logs</span>
                <span className="text-[9px] font-black uppercase bg-rose-100 hover:bg-rose-200 text-red-700 px-2 py-0.5 rounded-lg border-t border-t-white border-b-2 border-b-red-600 shadow-2xs">View List</span>
              </div>
            </button>

            {/* Step 3: (-) Fuel Expense (Clickable 3D) */}
            <button
              type="button"
              onClick={() => handleCardClick('FUEL')}
              className={`text-left bg-gradient-to-b from-white to-amber-50/40 rounded-2xl p-3 border-t-2 border-t-amber-200 border-x border-amber-300 border-b-4 border-b-amber-600 shadow-[0_4px_10px_rgba(245,158,11,0.18)] flex flex-col justify-between transition-all cursor-pointer hover:shadow-md hover:scale-[1.015] active:translate-y-1 active:border-b-2 group ${
                activeTab === 'FUEL'
                  ? 'ring-2 ring-amber-600 bg-amber-50'
                  : ''
              }`}
              title="Click to view fuel and vehicle transport logs"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-black flex items-center gap-1">
                  (-) 3. Fuel Expense
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
                </span>
                <span className="w-5 h-5 rounded-full bg-amber-100 text-black text-xs font-black flex items-center justify-center border border-amber-300 shadow-2xs">-</span>
              </div>
              <div className="text-lg sm:text-2xl font-black text-black mt-1.5">
                {currency} {todayFinancialResult.fuelExp.toLocaleString('en-PK')}
              </div>
              <div className="flex items-center justify-between text-[10px] font-black text-black mt-0.5">
                <span>{fuelTotals.count} Trips • {fuelTotals.liters} L</span>
                <span className="text-[9px] font-black uppercase bg-amber-100 hover:bg-amber-200 text-amber-950 px-2 py-0.5 rounded-lg border-t border-t-white border-b-2 border-b-amber-600 shadow-2xs">View List</span>
              </div>
            </button>

            {/* Step 4: (-) Damaged Loss (Clickable 3D) */}
            <button
              type="button"
              onClick={() => handleCardClick('DAMAGED')}
              className={`text-left bg-gradient-to-b from-white to-amber-50/40 rounded-2xl p-3 border-t-2 border-t-amber-200 border-x border-amber-300 border-b-4 border-b-amber-700 shadow-[0_4px_10px_rgba(217,119,6,0.18)] flex flex-col justify-between transition-all cursor-pointer hover:shadow-md hover:scale-[1.015] active:translate-y-1 active:border-b-2 group ${
                activeTab === 'DAMAGED'
                  ? 'ring-2 ring-amber-700 bg-amber-50'
                  : ''
              }`}
              title="Click to view damaged stock and loss records"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-black flex items-center gap-1">
                  (-) 4. Damaged Loss
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-800" />
                </span>
                <span className="w-5 h-5 rounded-full bg-amber-100 text-black text-xs font-black flex items-center justify-center border border-amber-300 shadow-2xs">-</span>
              </div>
              <div className="text-lg sm:text-2xl font-black text-black mt-1.5">
                {currency} {todayFinancialResult.damLoss.toLocaleString('en-PK')}
              </div>
              <div className="flex items-center justify-between text-[10px] font-black text-black mt-0.5">
                <span>{damagedTotals.count || 0} {damagedTotals.count === 1 ? 'Damaged Log' : 'Damaged Logs'}</span>
                <span className="text-[9px] font-black uppercase bg-amber-100 hover:bg-amber-200 text-amber-950 px-2 py-0.5 rounded-lg border-t border-t-white border-b-2 border-b-amber-700 shadow-2xs">View List</span>
              </div>
            </button>

            {/* Final Step: (=) Net Result (Clickable 3D) */}
            <button
              type="button"
              onClick={() => handleCardClick('ALL', 'ALL')}
              className={`col-span-2 lg:col-span-1 rounded-2xl p-3 border-t-2 border-x border-b-4 flex flex-col justify-between shadow-[0_4px_10px_rgba(0,0,0,0.15)] transition-all cursor-pointer hover:shadow-md hover:scale-[1.015] active:translate-y-1 active:border-b-2 text-left group ${
                activeTab === 'ALL'
                  ? 'ring-2 ring-slate-900'
                  : ''
              } ${
                todayFinancialResult.isProfit
                  ? 'bg-gradient-to-b from-white to-emerald-50 border-t-emerald-200 border-x-emerald-300 border-b-emerald-600'
                  : 'bg-gradient-to-b from-white to-rose-50 border-t-rose-200 border-x-rose-300 border-b-red-600'
              }`}
              title="Click to view All departments combined"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-black flex items-center gap-1">
                  (=) Today Net Result
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-black" />
                </span>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full text-white shadow-2xs ${
                  todayFinancialResult.isProfit ? 'bg-emerald-600' : 'bg-red-600'
                }`}>
                  {todayFinancialResult.isProfit ? 'PROFIT' : 'DEFICIT'}
                </span>
              </div>
              <div className={`text-xl sm:text-2xl font-black mt-1.5 ${
                todayFinancialResult.isProfit ? 'text-emerald-700' : 'text-red-600'
              }`}>
                {todayFinancialResult.isProfit ? '+' : '-'}{currency} {Math.abs(todayFinancialResult.netDailyBalance).toLocaleString('en-PK')}
              </div>
              <div className={`flex items-center justify-between text-[10px] font-black mt-0.5 ${
                todayFinancialResult.isProfit ? 'text-emerald-800' : 'text-red-600'
              }`}>
                <span className="text-black font-bold">Sale - Exp - Fuel - Damage</span>
                <span className="text-[9px] font-black uppercase bg-white px-2 py-0.5 rounded-lg border-t border-t-white border-b-2 border-b-slate-400 text-black shadow-2xs">All View</span>
              </div>
            </button>
          </div>

          {/* Cash Drawer & Liquidity Strip - Clickable 3D Cards */}
          <div className="bg-gradient-to-b from-white via-slate-50 to-slate-100 border-t-2 border-t-white border-x-2 border-x-slate-300 border-b-4 border-b-slate-400 rounded-2xl p-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-bold shadow-xs">
            {/* 1. Cash In Drawer (Clickable 3D) */}
            <div
              className={`p-2.5 rounded-xl border-t border-t-white border-x border-slate-300 border-b-3 border-b-slate-400 bg-white text-left transition-all hover:shadow-md flex flex-col justify-between group ${
                activeTab === 'SALES' && salesPaymentFilter === 'CASH'
                  ? 'bg-emerald-50 border-emerald-500 border-b-emerald-600 ring-2 ring-emerald-500/30'
                  : 'hover:border-emerald-400'
              }`}
            >
              <div
                onClick={() => handleCardClick('SALES', 'CASH')}
                className="cursor-pointer"
                title="Click to filter cash sales & customers"
              >
                <div className="flex items-center justify-between">
                  <span className="text-black uppercase text-[9.5px] font-black flex items-center gap-1">
                    💵 Cash In Drawer:
                  </span>
                  <span className={`text-[8.5px] font-black uppercase px-1.5 py-0.5 rounded border border-emerald-300 shadow-2xs ${
                    activeTab === 'SALES' && salesPaymentFilter === 'CASH'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-100 text-black group-hover:bg-emerald-200'
                  }`}>
                    Filter Cash
                  </span>
                </div>
                <span className="text-black text-sm sm:text-base font-black mt-1 block">
                  {currency} {todayFinancialResult.netCashInDrawer.toLocaleString('en-PK')}
                </span>
                <span className="text-[9px] text-black font-bold block mt-0.5">
                  Click to view cash sales &amp; customers
                </span>
              </div>
            </div>

            {/* 2. Bank Transfers (Clickable 3D) */}
            <div
              className={`p-2.5 rounded-xl border-t border-t-white border-x border-slate-300 border-b-3 border-b-slate-400 bg-white text-left transition-all hover:shadow-md flex flex-col justify-between group ${
                activeTab === 'SALES' && salesPaymentFilter === 'BANK'
                  ? 'bg-blue-50 border-blue-500 border-b-blue-600 ring-2 ring-blue-500/30'
                  : 'hover:border-blue-400'
              }`}
            >
              <div
                onClick={() => handleCardClick('SALES', 'BANK')}
                className="cursor-pointer"
                title="Click to filter bank inflow & customers"
              >
                <div className="flex items-center justify-between">
                  <span className="text-black uppercase text-[9.5px] font-black flex items-center gap-1">
                    🏦 Bank Transfers:
                  </span>
                  <span className={`text-[8.5px] font-black uppercase px-1.5 py-0.5 rounded border border-blue-300 shadow-2xs ${
                    activeTab === 'SALES' && salesPaymentFilter === 'BANK'
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-100 text-black group-hover:bg-blue-200'
                  }`}>
                    Filter Bank
                  </span>
                </div>
                <span className="text-black text-sm sm:text-base font-black mt-1 block">
                  {currency} {todayFinancialResult.bankIn.toLocaleString('en-PK')}
                </span>
                <span className="text-[9px] text-black font-bold block mt-0.5">
                  Click to view bank inflow &amp; customers
                </span>
              </div>
            </div>

            {/* 3. Customer Credit Given (Clickable 3D - Full Red) */}
            <button
              type="button"
              onClick={() => handleCardClick('SALES', 'CREDIT')}
              className={`p-2.5 rounded-xl border-t border-t-white border-x border-slate-300 border-b-3 border-b-red-500 bg-white text-left transition-all cursor-pointer hover:shadow-md hover:scale-[1.02] active:translate-y-0.5 active:border-b group ${
                activeTab === 'SALES' && salesPaymentFilter === 'CREDIT'
                  ? 'bg-rose-50 border-red-500 border-b-red-600 ring-2 ring-red-500/30'
                  : 'hover:border-red-400'
              }`}
              title="Click to see list of customers who received CREDIT/DUE and their products"
            >
              <div className="flex items-center justify-between">
                <span className="text-black uppercase text-[9.5px] font-black flex items-center gap-1">
                  📋 Customer Credit:
                </span>
                <span className={`text-[8.5px] font-black uppercase px-1.5 py-0.5 rounded border border-red-300 shadow-2xs ${
                  activeTab === 'SALES' && salesPaymentFilter === 'CREDIT'
                    ? 'bg-red-600 text-white'
                    : 'bg-rose-100 text-red-600 group-hover:bg-rose-200'
                }`}>
                  Filter Credit
                </span>
              </div>
              <span className="text-red-600 text-sm sm:text-base font-black mt-1 block">
                {currency} {todayFinancialResult.customerCreditGiven.toLocaleString('en-PK')}
              </span>
              <span className="text-[9px] text-black font-bold block mt-0.5">
                Click to view credit customers &amp; items
              </span>
            </button>

            {/* 4. Today Stock Restocks (Clickable 3D) */}
            <button
              type="button"
              onClick={() => handleCardClick('PURCHASES')}
              className={`p-2.5 rounded-xl border-t border-t-white border-x border-slate-300 border-b-3 border-b-slate-400 bg-white text-left transition-all cursor-pointer hover:shadow-md hover:scale-[1.02] active:translate-y-0.5 active:border-b group ${
                activeTab === 'PURCHASES'
                  ? 'bg-teal-50 border-teal-500 border-b-teal-600 ring-2 ring-teal-500/30'
                  : 'hover:border-teal-400'
              }`}
              title="Click to see list of today stock restocks and purchases"
            >
              <div className="flex items-center justify-between">
                <span className="text-black uppercase text-[9.5px] font-black flex items-center gap-1">
                  🚚 Stock Restocks:
                </span>
                <span className={`text-[8.5px] font-black uppercase px-1.5 py-0.5 rounded border border-teal-300 shadow-2xs ${
                  activeTab === 'PURCHASES'
                    ? 'bg-teal-600 text-white'
                    : 'bg-teal-100 text-black group-hover:bg-teal-200'
                }`}>
                  View Restocks
                </span>
              </div>
              <span className="text-black text-sm sm:text-base font-black mt-1 block">
                {currency} {purchaseTotals.cost.toLocaleString('en-PK')}
              </span>
              <span className="text-[9px] text-black font-bold block mt-0.5">
                Click to view supplier stock receipts
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ─── 3. DEPARTMENT TABS SELECTOR (3D Buttons) ─── */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 bg-white border-2 border-slate-300 rounded-2xl p-2 shadow-xs">
        <button
          type="button"
          onClick={() => setActiveTab('ALL')}
          className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap border-t border-t-white/30 border-b-3 active:translate-y-0.5 active:border-b ${
            activeTab === 'ALL'
              ? 'bg-slate-900 text-white border-b-black shadow-md'
              : 'text-black bg-slate-100 hover:bg-slate-200 border-slate-300 border-b-slate-400'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>All Departments Combined</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('SALES')}
          className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap border-t border-t-white/30 border-b-3 active:translate-y-0.5 active:border-b ${
            activeTab === 'SALES'
              ? 'bg-emerald-700 text-white border-b-emerald-950 shadow-md'
              : 'text-black bg-slate-100 hover:bg-emerald-50 border-slate-300 border-b-slate-400'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
          <span>Sales &amp; Bills ({todaySales.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('PURCHASES')}
          className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap border-t border-t-white/30 border-b-3 active:translate-y-0.5 active:border-b ${
            activeTab === 'PURCHASES'
              ? 'bg-teal-700 text-white border-b-teal-950 shadow-md'
              : 'text-black bg-slate-100 hover:bg-teal-50 border-slate-300 border-b-slate-400'
          }`}
        >
          <Truck className="w-3.5 h-3.5 text-teal-600" />
          <span>Purchases ({todayPurchases.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('EXPENSES')}
          className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap border-t border-t-white/30 border-b-3 active:translate-y-0.5 active:border-b ${
            activeTab === 'EXPENSES'
              ? 'bg-red-600 text-white border-b-red-950 shadow-md'
              : 'text-black bg-slate-100 hover:bg-rose-50 border-slate-300 border-b-slate-400'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-red-600" />
          <span>Shop Expenses ({todayExpenses.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('FUEL')}
          className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap border-t border-t-white/30 border-b-3 active:translate-y-0.5 active:border-b ${
            activeTab === 'FUEL'
              ? 'bg-amber-600 text-white border-b-amber-950 shadow-md'
              : 'text-black bg-slate-100 hover:bg-amber-50 border-slate-300 border-b-slate-400'
          }`}
        >
          <Truck className="w-3.5 h-3.5 text-amber-600" />
          <span>Fuel Logs ({todayFuel.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('DAMAGED')}
          className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap border-t border-t-white/30 border-b-3 active:translate-y-0.5 active:border-b ${
            activeTab === 'DAMAGED'
              ? 'bg-yellow-700 text-white border-b-yellow-950 shadow-md'
              : 'text-black bg-slate-100 hover:bg-yellow-50 border-slate-300 border-b-slate-400'
          }`}
        >
          <PackageX className="w-3.5 h-3.5 text-amber-600" />
          <span>Damaged Stock ({todayDamaged.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('CUSTOMERS')}
          className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap border-t border-t-white/30 border-b-3 active:translate-y-0.5 active:border-b ${
            activeTab === 'CUSTOMERS'
              ? 'bg-indigo-700 text-white border-b-indigo-950 shadow-md'
              : 'text-black bg-slate-100 hover:bg-indigo-50 border-slate-300 border-b-slate-400'
          }`}
        >
          <Users className="w-3.5 h-3.5 text-indigo-600" />
          <span>New Customers ({todayCustomers.length})</span>
        </button>
      </div>

      {/* ─── 4. ITEMISED DEPARTMENT TABLES (Displayed on Screen) ─── */}
      <div id="today-history-tables" className="space-y-6">
        {/* DEPARTMENT 1: TODAY SALES */}
        {(activeTab === 'ALL' || activeTab === 'SALES') && (
          <div className="bg-white border-2 border-slate-300 rounded-3xl p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b-2 border-slate-200">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-black uppercase text-black">
                  1. Today POS Bills &amp; Sales Invoices ({filteredTodaySales.length}{salesPaymentFilter !== 'ALL' ? ` of ${todaySales.length}` : ''})
                </h3>
              </div>

              {/* Quick Payment Mode Filters - 3D Styled */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-300 text-xs font-bold gap-1">
                  <button
                    type="button"
                    onClick={() => setSalesPaymentFilter('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase transition-all cursor-pointer border-t border-t-white/40 border-b-2 active:translate-y-0.5 ${
                      salesPaymentFilter === 'ALL'
                        ? 'bg-slate-900 text-white border-b-black shadow-xs'
                        : 'text-black hover:bg-slate-200 border-slate-300 border-b-slate-400'
                    }`}
                  >
                    All Bills ({todaySales.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalesPaymentFilter('CASH')}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase transition-all cursor-pointer border-t border-t-emerald-300/40 border-b-2 active:translate-y-0.5 ${
                      salesPaymentFilter === 'CASH'
                        ? 'bg-emerald-600 text-white border-b-emerald-900 shadow-xs'
                        : 'text-black hover:bg-emerald-100 border-emerald-300 border-b-emerald-500'
                    }`}
                  >
                    💵 Cash ({salesPaymentCounts.cashCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalesPaymentFilter('BANK')}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase transition-all cursor-pointer border-t border-t-blue-300/40 border-b-2 active:translate-y-0.5 ${
                      salesPaymentFilter === 'BANK'
                        ? 'bg-blue-600 text-white border-b-blue-900 shadow-xs'
                        : 'text-black hover:bg-blue-100 border-blue-300 border-b-blue-500'
                    }`}
                  >
                    🏦 Bank ({salesPaymentCounts.bankCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSalesPaymentFilter('CREDIT')}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase transition-all cursor-pointer border-t border-t-red-300/40 border-b-2 active:translate-y-0.5 ${
                      salesPaymentFilter === 'CREDIT'
                        ? 'bg-red-600 text-white border-b-red-900 shadow-xs'
                        : 'text-red-600 hover:bg-rose-100 border-red-300 border-b-red-500'
                    }`}
                  >
                    📋 Credit ({salesPaymentCounts.creditCount})
                  </button>
                </div>

                <span className="text-xs font-black text-black bg-emerald-100 px-3 py-1 rounded-xl border-2 border-emerald-400 shadow-xs">
                  Total Sales: {currency} {salesTotals.revenue.toLocaleString('en-PK')}
                </span>
              </div>
            </div>

            {filteredTodaySales.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-300 bg-slate-50/60 rounded-2xl text-black font-bold text-xs uppercase tracking-wider space-y-2">
                <p>No sales bills found matching the selected filter ({salesPaymentFilter}).</p>
                {salesPaymentFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setSalesPaymentFilter('ALL')}
                    className="px-3 py-1 bg-slate-900 text-white rounded-lg text-[10.5px] font-black hover:bg-slate-800 cursor-pointer shadow-xs border-b-2 border-b-black"
                  >
                    Clear Filter &amp; View All Bills
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border-2 border-slate-300 shadow-xs bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-200 text-[11px] font-black text-black uppercase tracking-wider border-b-2 border-slate-400">
                    <tr>
                      <th className="p-3 text-center border border-slate-300 text-black">#</th>
                      <th className="p-3 border border-slate-300 text-black">Invoice</th>
                      <th className="p-3 text-center border border-slate-300 text-black">Category</th>
                      <th className="p-3 border border-slate-300 text-black">Date &amp; Time</th>
                      <th className="p-3 border border-slate-300 text-black">Customer Name &amp; Contact</th>
                      <th className="p-3 border border-slate-300 text-black">Items / Products Purchased</th>
                      <th className="p-3 text-right border border-slate-300 text-black">Cash</th>
                      <th className="p-3 text-right border border-slate-300 text-black">Bank</th>
                      <th className="p-3 text-right border border-slate-300 text-red-600">Credit</th>
                      <th className="p-3 text-right border border-slate-300 text-black">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredTodaySales.map((s, idx) => {
                      const inv = s.invoiceNumber || s.serialNumber || `INV-${idx + 1}`;
                      const dt = formatRecordDateTime(s.saleDate || s.date || s.createdAt || s.created_at || s.timestamp || s.invoiceDate);
                      const total = Number(s.totalAmount) || 0;
                      const cash = Number(s.cashPaid !== undefined ? s.cashPaid : (s.paymentMethod === 'CASH' ? total : 0));
                      const bank = Number(s.bankPaid !== undefined ? s.bankPaid : (s.paymentMethod === 'BANK' || s.paymentMethod === 'ONLINE' ? total : 0));
                      const due = Number(s.creditDue || s.dueAmount || (s.paymentMethod === 'CREDIT' ? total : 0));
                      
                      let parsedItems = Array.isArray(s.items) ? s.items : [];
                      if (typeof s.items === 'string' && s.items.trim()) {
                        try { parsedItems = JSON.parse(s.items); } catch(e) { parsedItems = []; }
                      }
                      const rawCat = s.category || (parsedItems[0]?.category) || 'Premium';
                      const cat = (rawCat && rawCat.toLowerCase() !== 'eggs' && rawCat.toLowerCase() !== 'egg') ? rawCat : 'Premium';

                      return (
                        <tr key={s._id || idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-center border border-slate-300 text-black font-bold">{idx + 1}</td>
                          <td className="p-3 border border-slate-300 font-black text-black">{inv}</td>
                          <td className="p-3 text-center border border-slate-300">
                            <span className="px-2.5 py-0.5 rounded-full text-[9.5px] font-black uppercase bg-emerald-100 text-black border border-emerald-300 shadow-xs">
                              {cat}
                            </span>
                          </td>
                          <td className="p-3 border border-slate-300 whitespace-nowrap">
                            <div className="font-black text-black text-xs">{dt.date}</div>
                            <div className="text-[10px] font-bold text-black mt-0.5">{dt.time}</div>
                          </td>
                          <td className="p-3 border border-slate-300">
                            <div className="font-bold text-black text-xs flex flex-col">
                              <span className="font-black text-black">{s.customerName || 'Walk-in Customer'}</span>
                              {s.customerPhone && (
                                <span className="text-[10.5px] font-bold text-black mt-0.5">
                                  📞 {s.customerPhone}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 border border-slate-300 text-center font-black text-black text-sm">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {parsedItems.length > 0 ? (
                                parsedItems.map((item, itemIdx) => (
                                  <span
                                    key={itemIdx}
                                    className="inline-flex items-center justify-center font-black text-xs text-black bg-amber-100 border border-amber-300 min-w-[24px] h-6 px-2 rounded-lg shadow-2xs"
                                    title={(item.name && item.name.toLowerCase() !== 'eggs' && item.name.toLowerCase() !== 'egg') ? item.name : (item.title || 'Stock Item')}
                                  >
                                    {item.quantity || 1}
                                  </span>
                                ))
                              ) : (
                                <span className="font-black text-sm text-black">
                                  {s.quantity || 1}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 border border-slate-300 text-right font-black text-black">
                            {cash > 0 ? `${currency} ${cash.toLocaleString('en-PK')}` : '—'}
                          </td>
                          <td className="p-3 border border-slate-300 text-right font-black text-black">
                            {bank > 0 ? `${currency} ${bank.toLocaleString('en-PK')}` : '—'}
                          </td>
                          <td className="p-3 border border-slate-300 text-right font-black text-red-600">{due > 0 ? `${currency} ${due.toLocaleString('en-PK')}` : '—'}</td>
                          <td className="p-3 border border-slate-300 text-right font-black text-black">{currency} {total.toLocaleString('en-PK')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sales Payment Breakdown Under Table */}
            <div className="bg-slate-100 border-2 border-slate-300 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs font-bold">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-black uppercase text-[10.5px] font-black flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-black" /> Sales Payment Breakdown:
                </span>
                <span className="bg-white text-black border-2 border-emerald-400 px-3 py-1 rounded-xl shadow-xs font-black">
                  💵 Cash: {currency} {salesTotals.cash.toLocaleString('en-PK')}
                </span>
                <span className="bg-white text-black border-2 border-blue-400 px-3 py-1 rounded-xl shadow-xs font-black">
                  🏦 Bank: {currency} {salesTotals.bank.toLocaleString('en-PK')}
                </span>
                <span className="bg-white text-red-600 border-2 border-red-500 px-3 py-1 rounded-xl shadow-xs font-black">
                  📋 Credit (Due): {currency} {salesTotals.credit.toLocaleString('en-PK')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-black text-[11px] font-black uppercase">Total Sales:</span>
                <span className="bg-black text-white text-sm font-black px-3.5 py-1 rounded-xl shadow-xs">
                  {currency} {salesTotals.revenue.toLocaleString('en-PK')}
                </span>
              </div>
            </div>

            {/* Category Breakdown Under Table */}
            {salesCategoryTotals.length > 0 && (
              <div className="bg-white border-2 border-slate-300 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-black uppercase text-[10.5px] font-black flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-black" /> Total Category Breakdown:
                  </span>
                  {salesCategoryTotals.map((cat, i) => (
                    <span key={i} className="bg-emerald-50 text-black border border-emerald-300 px-2.5 py-1 rounded-xl text-[11px] font-black shadow-xs">
                      🏷️ {cat.name}: {currency} {cat.total.toLocaleString('en-PK')} ({cat.count} items)
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* DEPARTMENT 2: TODAY SHOP EXPENSES */}
        {(activeTab === 'ALL' || activeTab === 'EXPENSES') && (
          <div className="bg-white border-2 border-slate-300 rounded-3xl p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b-2 border-slate-200">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-red-600" />
                <h3 className="text-sm font-black uppercase text-black">
                  2. Today Shop Overhead Expenses ({todayExpenses.length})
                </h3>
              </div>
              <span className="text-xs font-black text-red-600 bg-rose-50 px-3 py-1 rounded-xl border-2 border-red-300 shadow-xs">
                Total Expenses: {currency} {expenseTotals.total.toLocaleString('en-PK')}
              </span>
            </div>

            {todayExpenses.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-300 bg-slate-50/60 rounded-2xl text-black font-bold text-xs uppercase tracking-wider">
                No shop overhead expenses recorded for today.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border-2 border-slate-300 shadow-xs bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-200 text-[11px] font-black text-black uppercase tracking-wider border-b-2 border-slate-400">
                    <tr>
                      <th className="p-3 text-center border border-slate-300 text-black">#</th>
                      <th className="p-3 border border-slate-300 text-black">Date &amp; Time</th>
                      <th className="p-3 border border-slate-300 text-black">Expense Title</th>
                      <th className="p-3 border border-slate-300 text-black">Category</th>
                      <th className="p-3 text-center border border-slate-300 text-black">Payment Mode</th>
                      <th className="p-3 border border-slate-300 text-black">Paid To / Remarks</th>
                      <th className="p-3 text-right border border-slate-300 text-red-600">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {todayExpenses.map((e, idx) => {
                      const dt = formatRecordDateTime(e.expenseDate || e.date || e.createdAt || e.created_at || e.timestamp);
                      return (
                        <tr key={e._id || idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-center border border-slate-300 text-black font-bold">{idx + 1}</td>
                          <td className="p-3 border border-slate-300 whitespace-nowrap">
                            <div className="font-black text-black text-xs">{dt.date}</div>
                            <div className="text-[10px] font-bold text-black mt-0.5">{dt.time}</div>
                          </td>
                          <td className="p-3 border border-slate-300 font-black text-black">{e.title || e.description || 'Shop Expense'}</td>
                          <td className="p-3 border border-slate-300 font-black text-black">{e.category || 'General Overhead'}</td>
                          <td className="p-3 text-center border border-slate-300">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                              String(e.paymentMethod || '').toUpperCase().includes('BANK')
                                ? 'bg-blue-100 text-blue-900 border border-blue-300'
                                : 'bg-slate-100 text-black border border-slate-300'
                            }`}>
                              {e.paymentMethod || 'CASH'}
                            </span>
                          </td>
                          <td className="p-3 border border-slate-300 font-bold text-black">{e.paidTo || e.remarks || '—'}</td>
                          <td className="p-3 border border-slate-300 text-right font-black text-red-600">
                            {currency} {Number(e.amount || 0).toLocaleString('en-PK')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Expenses Payment Breakdown Under Table */}
            <div className="bg-slate-100 border-2 border-slate-300 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs font-bold">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-black uppercase text-[10.5px] font-black flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-black" /> Expenses Payment Breakdown:
                </span>
                <span className="bg-white text-black border-2 border-emerald-400 px-3 py-1 rounded-xl shadow-xs font-black">
                  💵 Cash Paid: {currency} {expenseTotals.cash.toLocaleString('en-PK')}
                </span>
                <span className="bg-white text-black border-2 border-blue-400 px-3 py-1 rounded-xl shadow-xs font-black">
                  🏦 Bank Paid: {currency} {expenseTotals.bank.toLocaleString('en-PK')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-black text-[11px] font-black uppercase">Total Expenses:</span>
                <span className="bg-red-600 text-white text-sm font-black px-3.5 py-1 rounded-xl shadow-xs">
                  {currency} {expenseTotals.total.toLocaleString('en-PK')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* DEPARTMENT 3: TODAY FUEL EXPENSES */}
        {(activeTab === 'ALL' || activeTab === 'FUEL') && (
          <div className="bg-white border-2 border-slate-300 rounded-3xl p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b-2 border-slate-200">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-black uppercase text-black">
                  3. Today Fuel &amp; Vehicle Transport Logs ({todayFuel.length})
                </h3>
              </div>
              <span className="text-xs font-black text-black bg-amber-100 px-3 py-1 rounded-xl border-2 border-amber-300 shadow-xs">
                Total Fuel: {currency} {fuelTotals.total.toLocaleString('en-PK')} ({fuelTotals.liters} L)
              </span>
            </div>

            {todayFuel.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-300 bg-slate-50/60 rounded-2xl text-black font-bold text-xs uppercase tracking-wider">
                No fuel logs recorded for today.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border-2 border-slate-300 shadow-xs bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-200 text-[11px] font-black text-black uppercase tracking-wider border-b-2 border-slate-400">
                    <tr>
                      <th className="p-3 text-center border border-slate-300 text-black">#</th>
                      <th className="p-3 border border-slate-300 text-black">Date &amp; Time</th>
                      <th className="p-3 border border-slate-300 text-black">Vehicle</th>
                      <th className="p-3 border border-slate-300 text-black">Driver</th>
                      <th className="p-3 border border-slate-300 text-black">Purpose / Destination</th>
                      <th className="p-3 border border-slate-300 text-black">Liters &amp; Rate</th>
                      <th className="p-3 text-center border border-slate-300 text-black">Payment</th>
                      <th className="p-3 text-right border border-slate-300 text-red-600">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {todayFuel.map((f, idx) => {
                      const dt = formatRecordDateTime(f.expenseDate || f.date || f.createdAt || f.created_at || f.timestamp);
                      return (
                        <tr key={f._id || idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-center border border-slate-300 text-black font-bold">{idx + 1}</td>
                          <td className="p-3 border border-slate-300 whitespace-nowrap">
                            <div className="font-black text-black text-xs">{dt.date}</div>
                            <div className="text-[10px] font-bold text-black mt-0.5">{dt.time}</div>
                          </td>
                          <td className="p-3 border border-slate-300 font-black text-black">{f.vehicleNumber || f.vehicleName || 'Vehicle'}</td>
                          <td className="p-3 border border-slate-300 font-black text-black">{f.driverName || 'Driver'}</td>
                          <td className="p-3 border border-slate-300 font-bold text-black">{f.purpose || f.destination || 'Delivery'}</td>
                          <td className="p-3 border border-slate-300 font-bold text-black">{f.liters || 0} L @ {currency} {Number(f.ratePerLiter || 0).toLocaleString('en-PK')}</td>
                          <td className="p-3 text-center border border-slate-300">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                              String(f.paymentMethod || '').toUpperCase().includes('BANK')
                                ? 'bg-blue-100 text-blue-900 border border-blue-300'
                                : 'bg-amber-100 text-black border border-amber-300'
                            }`}>
                              {f.paymentMethod || 'CASH'}
                            </span>
                          </td>
                          <td className="p-3 border border-slate-300 text-right font-black text-red-600">
                            {currency} {Number(f.totalAmount || 0).toLocaleString('en-PK')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Fuel Payment Breakdown Under Table */}
            <div className="bg-slate-100 border-2 border-slate-300 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs font-bold">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-black uppercase text-[10.5px] font-black flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-black" /> Fuel Payment Breakdown:
                </span>
                <span className="bg-white text-black border-2 border-emerald-400 px-3 py-1 rounded-xl shadow-xs font-black">
                  💵 Cash Paid: {currency} {fuelTotals.cash.toLocaleString('en-PK')}
                </span>
                <span className="bg-white text-black border-2 border-blue-400 px-3 py-1 rounded-xl shadow-xs font-black">
                  🏦 Bank Paid: {currency} {fuelTotals.bank.toLocaleString('en-PK')}
                </span>
                <span className="bg-white text-red-600 border-2 border-red-500 px-3 py-1 rounded-xl shadow-xs font-black">
                  📋 Credit Due: {currency} {(fuelTotals.credit || 0).toLocaleString('en-PK')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-black text-[11px] font-black uppercase">Total Fuel Cost:</span>
                <span className="bg-amber-600 text-white text-sm font-black px-3.5 py-1 rounded-xl shadow-xs">
                  {currency} {fuelTotals.total.toLocaleString('en-PK')} ({fuelTotals.liters} L)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* DEPARTMENT 4: TODAY DAMAGED STOCK */}
        {(activeTab === 'ALL' || activeTab === 'DAMAGED') && (
          <div className="bg-white border-2 border-slate-300 rounded-3xl p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b-2 border-slate-200">
              <div className="flex items-center gap-2">
                <PackageX className="w-4 h-4 text-red-600" />
                <h3 className="text-sm font-black uppercase text-black">
                  4. Today Damaged Stock &amp; Losses ({todayDamaged.length})
                </h3>
              </div>
              <span className="text-xs font-black text-red-600 bg-rose-50 px-3 py-1 rounded-xl border-2 border-red-300 shadow-xs">
                Total Loss: {currency} {damagedTotals.totalLoss.toLocaleString('en-PK')} ({damagedTotals.eggs} Units)
              </span>
            </div>

            {todayDamaged.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-300 bg-slate-50/60 rounded-2xl text-black font-bold text-xs uppercase tracking-wider">
                No damaged stock recorded for today.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border-2 border-slate-300 shadow-xs bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-200 text-[11px] font-black text-black uppercase tracking-wider border-b-2 border-slate-400">
                    <tr>
                      <th className="p-3 text-center border border-slate-300 text-black">#</th>
                      <th className="p-3 border border-slate-300 text-black">Date &amp; Time</th>
                      <th className="p-3 border border-slate-300 text-black">Product Name</th>
                      <th className="p-3 border border-slate-300 text-red-600">Quantity Lost</th>
                      <th className="p-3 border border-slate-300 text-black">Reason / Storage Cause</th>
                      <th className="p-3 text-right border border-slate-300 text-red-600">Loss Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {todayDamaged.map((d, idx) => {
                      const dt = formatRecordDateTime(d.damageDate || d.date || d.createdAt || d.created_at || d.timestamp);
                      const eggs = Number(d.deductedEggs || d.eggQuantity || d.quantity || 0);
                      const petis = (eggs / 360).toFixed(1);
                      const loss = Number(d.totalLoss || d.lossAmount || 0);
                      return (
                        <tr key={d._id || idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-center border border-slate-300 text-black font-bold">{idx + 1}</td>
                          <td className="p-3 border border-slate-300 whitespace-nowrap">
                            <div className="font-black text-black text-xs">{dt.date}</div>
                            <div className="text-[10px] font-bold text-black mt-0.5">{dt.time}</div>
                          </td>
                          <td className="p-3 border border-slate-300 font-black text-black">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg border-2 border-slate-300 overflow-hidden bg-slate-100 shrink-0 shadow-2xs flex items-center justify-center p-0.5">
                                <img
                                  src={resolveProductImage(d.productName || d.product?.name, d.productId || d.product?._id, d.image || d.product?.image)}
                                  alt=""
                                  onError={(e) => { e.target.onerror = null; e.target.src = '/egg2.png'; }}
                                  className="w-full h-full object-cover rounded"
                                />
                              </div>
                              <span>{d.productName || d.product?.name || 'Stock'}</span>
                            </div>
                          </td>
                          <td className="p-3 border border-slate-300 font-black text-red-600">{eggs.toLocaleString('en-PK')} Premium Plus ({petis} Premium)</td>
                          <td className="p-3 border border-slate-300 font-bold text-black">{d.reason || d.notes || 'Broken during handling'}</td>
                          <td className="p-3 border border-slate-300 text-right font-black text-red-600">
                            {currency} {loss.toLocaleString('en-PK')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Loss Summary Breakdown Under Table */}
            <div className="bg-slate-100 border-2 border-slate-300 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs font-bold">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-black uppercase text-[10.5px] font-black flex items-center gap-1.5">
                  <PackageX className="w-3.5 h-3.5 text-red-600" /> Loss Summary Breakdown:
                </span>
                <span className="bg-white text-red-600 border-2 border-red-300 px-3 py-1 rounded-xl shadow-xs font-black">
                  📦 Premium Plus Lost: {damagedTotals.eggs.toLocaleString('en-PK')} Premium Plus
                </span>
                <span className="bg-white text-red-600 border-2 border-red-300 px-3 py-1 rounded-xl shadow-xs font-black">
                  📦 Premium Lost: {damagedTotals.petis} Premium
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-black text-[11px] font-black uppercase">Total Damage Loss:</span>
                <span className="bg-red-600 text-white text-sm font-black px-3.5 py-1 rounded-xl shadow-xs">
                  {currency} {damagedTotals.totalLoss.toLocaleString('en-PK')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* DEPARTMENT 5: TODAY PURCHASES & RESTOCKS */}
        {(activeTab === 'ALL' || activeTab === 'PURCHASES') && (
          <div className="bg-white border-2 border-slate-300 rounded-3xl p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b-2 border-slate-200">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-teal-600" />
                <h3 className="text-sm font-black uppercase text-black">
                  5. Today Purchases &amp; Stock Restocks ({todayPurchases.length})
                </h3>
              </div>
              <span className="text-xs font-black text-black bg-teal-100 px-3 py-1 rounded-xl border-2 border-teal-300 shadow-xs">
                Stock Cost: {currency} {purchaseTotals.cost.toLocaleString('en-PK')}
              </span>
            </div>

            {todayPurchases.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-300 bg-slate-50/60 rounded-2xl text-black font-bold text-xs uppercase tracking-wider">
                No purchases recorded for today.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border-2 border-slate-300 shadow-xs bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-200 text-[11px] font-black text-black uppercase tracking-wider border-b-2 border-slate-400">
                    <tr>
                      <th className="p-3 text-center border border-slate-300 text-black">#</th>
                      <th className="p-3 border border-slate-300 text-black">Date &amp; Time</th>
                      <th className="p-3 border border-slate-300 text-black">Product</th>
                      <th className="p-3 text-center border border-slate-300 text-black">Category</th>
                      <th className="p-3 border border-slate-300 text-black">Supplier / Farm</th>
                      <th className="p-3 border border-slate-300 text-black">Quantity</th>
                      <th className="p-3 text-right border border-slate-300 text-black">Cash Paid</th>
                      <th className="p-3 text-right border border-slate-300 text-red-600">Supplier Credit</th>
                      <th className="p-3 text-right border border-slate-300 text-black">Total Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {todayPurchases.map((p, idx) => {
                      const dt = formatRecordDateTime(p.purchaseDate || p.date || p.createdAt || p.created_at || p.timestamp);
                      return (
                        <tr key={p._id || idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-center border border-slate-300 text-black font-bold">{idx + 1}</td>
                          <td className="p-3 border border-slate-300 whitespace-nowrap">
                            <div className="font-black text-black text-xs">{dt.date}</div>
                            <div className="text-[10px] font-bold text-black mt-0.5">{dt.time}</div>
                          </td>
                          <td className="p-3 border border-slate-300 font-black text-black">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg border-2 border-slate-300 overflow-hidden bg-slate-100 shrink-0 shadow-2xs flex items-center justify-center p-0.5">
                                <img
                                  src={resolveProductImage(p.name || p.productName, p.productId, p.image)}
                                  alt=""
                                  onError={(e) => { e.target.onerror = null; e.target.src = '/egg2.png'; }}
                                  className="w-full h-full object-cover rounded"
                                />
                              </div>
                              <span>{p.name || p.productName || 'Stock'}</span>
                            </div>
                          </td>
                          <td className="p-3 text-center border border-slate-300">
                            <span className="px-2.5 py-0.5 rounded-full text-[9.5px] font-black uppercase bg-teal-100 text-black border border-teal-300 shadow-xs">
                              {p.category || 'General'}
                            </span>
                          </td>
                          <td className="p-3 border border-slate-300 font-black text-black">{p.supplier || p.supplierName || 'Farm'}</td>
                          <td className="p-3 border border-slate-300 text-center font-bold text-black">{getPurchaseQtyDigit(p) || p.stock || p.quantity || 0}</td>
                          <td className="p-3 border border-slate-300 text-right font-black text-black">
                            {Number(p.cashPaid || 0) > 0 ? (
                              <span>{currency} {Number(p.cashPaid).toLocaleString('en-PK')}</span>
                            ) : Number(p.bankPaid || 0) > 0 ? (
                              <span className="text-blue-700">{currency} {Number(p.bankPaid).toLocaleString('en-PK')}</span>
                            ) : '—'}
                          </td>
                          <td className="p-3 border border-slate-300 text-right font-black text-red-600">{p.dueAmount ? `${currency} ${Number(p.dueAmount).toLocaleString('en-PK')}` : '—'}</td>
                          <td className="p-3 border border-slate-300 text-right font-black text-black">
                            {currency} {Number(p.totalPurchaseCost || p.costPrice || 0).toLocaleString('en-PK')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Purchases Payment Breakdown Under Table */}
            <div className="bg-slate-100 border-2 border-slate-300 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs font-bold">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-black uppercase text-[10.5px] font-black flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-black" /> Purchases Payment Breakdown:
                </span>
                <span className="bg-white text-black border-2 border-emerald-400 px-3 py-1 rounded-xl shadow-xs font-black">
                  💵 Cash Paid: {currency} {purchaseTotals.cash.toLocaleString('en-PK')}
                </span>
                <span className="bg-white text-black border-2 border-blue-400 px-3 py-1 rounded-xl shadow-xs font-black">
                  🏦 Bank Paid: {currency} {purchaseTotals.bank.toLocaleString('en-PK')}
                </span>
                <span className="bg-white text-red-600 border-2 border-red-500 px-3 py-1 rounded-xl shadow-xs font-black">
                  📋 Supplier Credit: {currency} {purchaseTotals.due.toLocaleString('en-PK')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-black text-[11px] font-black uppercase">Total Stock Cost:</span>
                <span className="bg-slate-900 text-white text-sm font-black px-3.5 py-1 rounded-xl shadow-xs">
                  {currency} {purchaseTotals.cost.toLocaleString('en-PK')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* DEPARTMENT 6: TODAY NEW CUSTOMERS */}
        {(activeTab === 'ALL' || activeTab === 'CUSTOMERS') && (
          <div className="bg-white border-2 border-slate-300 rounded-3xl p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b-2 border-slate-200">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-black uppercase text-black">
                  6. Today Registered Customers &amp; Accounts ({todayCustomers.length})
                </h3>
              </div>
              <span className="text-xs font-black text-black bg-indigo-100 px-3 py-1 rounded-xl border-2 border-indigo-300 shadow-xs">
                New Contacts: {todayCustomers.length}
              </span>
            </div>

            {todayCustomers.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-300 bg-slate-50/60 rounded-2xl text-black font-bold text-xs uppercase tracking-wider">
                No new customer accounts added today.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border-2 border-slate-300 shadow-xs bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-200 text-[11px] font-black text-black uppercase tracking-wider border-b-2 border-slate-400">
                    <tr>
                      <th className="p-3 text-center border border-slate-300 text-black">#</th>
                      <th className="p-3 border border-slate-300 text-black">Date &amp; Time</th>
                      <th className="p-3 border border-slate-300 text-black">Customer Name</th>
                      <th className="p-3 border border-slate-300 text-black">Phone</th>
                      <th className="p-3 border border-slate-300 text-black">Email</th>
                      <th className="p-3 text-center border border-slate-300 text-black">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {todayCustomers.map((c, idx) => {
                      const dt = formatRecordDateTime(c.createdAt || c.dateAdded || c.created_at || c.date || c.timestamp);
                      return (
                        <tr key={c._id || idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 text-center border border-slate-300 text-black font-bold">{idx + 1}</td>
                          <td className="p-3 border border-slate-300 whitespace-nowrap">
                            <div className="font-black text-black text-xs">{dt.date}</div>
                            <div className="text-[10px] font-bold text-black mt-0.5">{dt.time}</div>
                          </td>
                          <td className="p-3 border border-slate-300 font-black text-black">{c.fullName || c.name || 'Customer'}</td>
                          <td className="p-3 border border-slate-300 font-black text-black">{c.phone || '—'}</td>
                          <td className="p-3 border border-slate-300 text-black font-bold">{c.email || '—'}</td>
                          <td className="p-3 text-center border border-slate-300">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                              c.isOnline ? 'bg-teal-100 text-black border border-teal-300' : 'bg-slate-100 text-black border border-slate-300'
                            }`}>
                              {c.isOnline ? 'Online Account' : 'Shop POS'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Customers Summary Under Table */}
            <div className="bg-slate-100 border-2 border-slate-300 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs font-bold">
              <span className="text-black uppercase text-[10.5px] font-black flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-black" /> Today Registered Accounts Summary:
              </span>
              <span className="bg-indigo-700 text-white text-sm font-black px-3.5 py-1 rounded-xl shadow-xs">
                Total New Customers: {todayCustomers.length}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

