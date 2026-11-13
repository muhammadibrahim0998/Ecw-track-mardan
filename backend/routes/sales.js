import express from 'express';
const router = express.Router();
import Sale from '../models/Sale.js';
import Order from '../models/Order.js';
import Item, { getBranchItemModel } from '../models/Item.js';
import Purchase from '../models/Purchase.js';
import CashSession from '../models/CashSession.js';
import Customer from '../models/Customer.js';
import CustomerCredit from '../models/CustomerCredit.js';
import CustomerPaymentLedger from '../models/CustomerPaymentLedger.js';
import VendorPaymentLedger from '../models/VendorPaymentLedger.js';
import { generateInvoice } from '../utils/generateInvoice.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import Settings from '../models/Settings.js';
import Shop from '../models/Shop.js';
import { authenticate, requireShopAdmin, preventSuperAdmin } from '../middleware/auth.js';
import { resolveShopId } from '../utils/shopResolver.js';
import pool from '../config/mysql.js';
import { BRANCH_TABLE_PREFIXES, ALL_BRANCH_PREFIXES } from '../models/dbHelper.js';

// Helper to get all actual active branch prefixes dynamically from MySQL
const getAllBranchPrefixesList = async () => {
  try {
    const [tables] = await pool.query("SHOW TABLES LIKE '%customer_payment_ledger%'");
    const prefixes = new Set(Array.isArray(ALL_BRANCH_PREFIXES) ? ALL_BRANCH_PREFIXES : ['peshawar_branch', 'mardan_branch', 'attock_branch']);
    for (const t of tables) {
      const tableName = Object.values(t)[0];
      if (tableName && tableName.includes('__customer_payment_ledger')) {
        const pfx = tableName.split('__')[0];
        if (pfx) prefixes.add(pfx);
      }
    }
    return Array.from(prefixes);
  } catch (_) {
    return Array.isArray(ALL_BRANCH_PREFIXES) ? ALL_BRANCH_PREFIXES : ['peshawar_branch', 'mardan_branch', 'attock_branch', 'swat_branch', 'shop_9_branch'];
  }
};
import { syncSaleToBranchHistories, removeSaleFromBranchHistories, getBranchTodayFinancialSummary } from '../utils/branchTableManager.js';

// Helper to dynamically hydrate items on any sale record (online & local branches)
const hydrateSaleItems = async (s, branchPrefix = 'peshawar_branch') => {
  if (!s) return s;

  let items = [];
  if (Array.isArray(s.items)) {
    items = s.items;
  } else if (typeof s.items === 'string' && s.items.trim()) {
    try {
      items = JSON.parse(s.items);
      if (typeof items === 'string') items = JSON.parse(items);
    } catch (_) { items = []; }
  }
  if (!Array.isArray(items)) items = [];

  // 1. If items is empty, try querying sale_items table
  if (items.length === 0 && (s.id || s._id)) {
    const saleId = s.id || s._id;
    try {
      let [rows] = await pool.query(
        `SELECT * FROM \`${branchPrefix}__sale_items\` WHERE saleId = ?`,
        [saleId]
      ).catch(() => [[]]);

      if (!rows || rows.length === 0) {
        [rows] = await pool.query(
          `SELECT * FROM \`sale_items\` WHERE saleId = ?`,
          [saleId]
        ).catch(() => [[]]);
      }

      if (rows && rows.length > 0) {
        items = rows.map(r => {
          const qty = Number(r.quantity) || 1;
          const rawUnit = (r.unit || r.unitType || 'peti').toLowerCase();
          const unit = rawUnit.includes('peti') ? 'peti' : (rawUnit.includes('tray') ? 'tray' : 'egg');
          const unitLabel = unit === 'peti' ? 'Peti' : (unit === 'tray' ? 'Tray' : 'Egg');
          const tEggs = Number(r.totalEggs) > 0 ? Number(r.totalEggs) : (unit === 'peti' ? qty * 360 : (unit === 'tray' ? qty * 30 : qty));
          const name = r.name || 'Eggs';
          return {
            productId: r.productId,
            name,
            rawProductName: name,
            quantity: qty,
            unit,
            unitLabel,
            totalEggs: tEggs,
            price: Number(r.price) || 0,
            costPrice: Number(r.costPrice) || 0,
            subtotal: Number(r.subtotal) || 0,
            profit: Number(r.profit) || 0
          };
        });
      }
    } catch (_) {}
  }

  // 2. If items is still empty, look up in customer_payment_ledger
  if (items.length === 0 && (s.id || s.invoiceNumber)) {
    try {
      let [cplRows] = await pool.query(
        `SELECT * FROM \`${branchPrefix}__customer_payment_ledger\` WHERE saleId = ? OR invoiceNumber = ? LIMIT 1`,
        [String(s.id || s._id), String(s.invoiceNumber || '')]
      ).catch(() => [[]]);

      if (!cplRows || cplRows.length === 0) {
        [cplRows] = await pool.query(
          `SELECT * FROM \`customer_payment_ledger\` WHERE saleId = ? OR invoiceNumber = ? LIMIT 1`,
          [String(s.id || s._id), String(s.invoiceNumber || '')]
        ).catch(() => [[]]);
      }

      if (cplRows && cplRows.length > 0) {
        const c = cplRows[0];
        if (c.items) {
          try {
            const parsed = typeof c.items === 'string' ? JSON.parse(c.items) : c.items;
            if (Array.isArray(parsed) && parsed.length > 0) items = parsed;
          } catch (_) {}
        }
        if (items.length === 0 && c.itemsDescription) {
          s.itemsDescription = c.itemsDescription;
        }
        if (!s.petisBought && Number(c.petisBought) > 0) s.petisBought = Number(c.petisBought);
        if (!s.eggsBought && Number(c.eggsBought) > 0) s.eggsBought = Number(c.eggsBought);
      }
    } catch (_) {}
  }

  // 3. Parse items from itemsDescription (e.g. "egg x4 Peti", "Golden (4 peti)", "Breeder (1 Peti)", "egg (10 peti)")
  if (items.length === 0 && s.itemsDescription && typeof s.itemsDescription === 'string') {
    const parts = s.itemsDescription.split(',').map(p => p.trim()).filter(Boolean);
    parts.forEach(part => {
      const match = part.match(/^([^(x]+?)(?:\s*(?:x|\()\s*([\d\.]+)\s*([a-zA-Z]+))?/i);
      if (match) {
        const rawName = (match[1] || 'Eggs').trim();
        const cleanName = rawName.replace(/\s*\(.*?\)/g, '').trim() || 'Eggs';
        const qty = Number(match[2]) || (Number(s.petisBought) > 0 ? Number(s.petisBought) : 1);
        const rawUnit = (match[3] || 'Peti').toLowerCase();
        const unit = rawUnit.includes('peti') ? 'peti' : (rawUnit.includes('tray') ? 'tray' : 'egg');
        const unitLabel = unit === 'peti' ? 'Peti' : (unit === 'tray' ? 'Tray' : 'Egg');
        const tEggs = unit === 'peti' ? qty * 360 : (unit === 'tray' ? qty * 30 : qty);
        items.push({
          name: cleanName,
          rawProductName: cleanName,
          quantity: qty,
          unit,
          unitLabel,
          totalEggs: tEggs,
          subtotal: Number(s.totalAmount) || 0
        });
      }
    });
  }

  // 4. Construct from petisBought / eggsBought / category
  if (items.length === 0) {
    const pBought = Number(s.petisBought) || 0;
    const eBought = Number(s.eggsBought) || 0;
    const totAmt = Number(s.totalAmount) || 0;
    const prodName = s.category || 'Eggs';

    if (pBought > 0) {
      items.push({
        name: prodName,
        rawProductName: prodName,
        quantity: pBought,
        unit: 'peti',
        unitLabel: 'Peti',
        totalEggs: pBought * 360,
        subtotal: totAmt
      });
    } else if (eBought > 0) {
      const petisFromEggs = Number((eBought / 360).toFixed(1));
      items.push({
        name: prodName,
        rawProductName: prodName,
        quantity: petisFromEggs >= 1 ? petisFromEggs : eBought,
        unit: petisFromEggs >= 1 ? 'peti' : 'egg',
        unitLabel: petisFromEggs >= 1 ? 'Peti' : 'Egg',
        totalEggs: eBought,
        subtotal: totAmt
      });
    } else if (totAmt > 0) {
      const calcPetis = Math.max(1, Number((totAmt / 1050).toFixed(1)));
      items.push({
        name: prodName,
        rawProductName: prodName,
        quantity: calcPetis,
        unit: 'peti',
        unitLabel: 'Peti',
        totalEggs: Math.round(calcPetis * 360),
        subtotal: totAmt
      });
    }
  }

  // 5. Standardize every item object
  s.items = items.map(it => {
    const q = Number(it.quantity) || 1;
    const rawU = String(it.unitLabel || it.unit || 'peti').toLowerCase().trim();
    const u = rawU.includes('peti') ? 'peti' : (rawU.includes('tray') ? 'tray' : 'egg');
    const uLabel = u === 'peti' ? 'Peti' : (u === 'tray' ? 'Tray' : 'Egg');
    let tEggs = Number(it.totalEggs);
    if (!tEggs || isNaN(tEggs)) {
      tEggs = u === 'peti' ? q * 360 : (u === 'tray' ? q * 30 : q);
    }
    const cleanName = (it.rawProductName || it.name || it.title || 'Eggs').replace(/\s*\(.*?\)/g, '').trim() || 'Eggs';
    return {
      ...it,
      name: cleanName,
      rawProductName: cleanName,
      quantity: q,
      unit: u,
      unitLabel: uLabel,
      totalEggs: tEggs
    };
  });

  return s;
};

// Helper to check Super Admin approval for branch edit/delete/page permission
const checkBranchApproval = async (req, actionType = 'edit', requiredPage = 'sales') => {
  if (req.user?.role === 'super_admin' || req.headers['x-user-role'] === 'super_admin') return true;
  const rawShopId = req.user?.shopId || req.headers['x-shop-id'] || req.query?.shopId || req.body?.shopId || req.params?.shopId || 1;
  const sId = await resolveShopId(rawShopId);
  if (!sId) return true;
  try {
    const targetShop = await Shop.findById(sId);
    if (!targetShop) return true;
    if (targetShop.approvalStatus === 'LOCKED') return false;

    let allowed = targetShop.allowedPages;
    if (typeof allowed === 'string') {
      try { allowed = JSON.parse(allowed); } catch { allowed = []; }
    }
    if (Array.isArray(allowed)) {
      const hasGranularOps = allowed.some(k => typeof k === 'string' && (k.endsWith('_edit') || k.endsWith('_delete')));
      if (hasGranularOps) {
        const opKey = `${requiredPage}_${actionType}`;
        return allowed.includes(opKey);
      }
    }

    if (actionType === 'edit' && Number(targetShop.isEditApproved) === 0) return false;
    if (actionType === 'delete' && Number(targetShop.isDeleteApproved) === 0) return false;
    return true;
  } catch (err) {
    return true;
  }
};

// Helper to verify Owner Password (Anti-Theft)
// We now use `authenticate` and `requireShopAdmin` standard RBAC for powerful actions
// If you want to keep the literal pin-based password logic, you can combine them, but for Multi-Tenant RBAC
// checking user roles (requireShopAdmin) is standard. We'll leave the password check wrapped over the new system to preserve feature parity.
const verifyOwnerPassword = async (req, res, next) => {
  try {
    const password = req.headers['x-owner-password'];
    
    // Bypass if user is super admin or shop admin from token
    if (req.user && ['super_admin', 'shop_admin'].includes(req.user.role)) return next();

    let settings = await Settings.findOne({ shopId: req.user.shopId });
    if (!settings) {
      settings = new Settings();
      await settings.save();
    }
    const correctPassword = settings.ownerPassword;
    
    if (password !== correctPassword) {
      return res.status(403).json({ message: "Owner authorization required for this action." });
    }
    next();
  } catch (err) {
    res.status(500).json({ message: "Auth check failed" });
  }
};

// ── Super Admin: Get ALL sales across all shops ──────────────────────
router.get('/all', authenticate, async (req, res) => {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ message: 'Super Admin only.' });
  }
  try {
    const sales = await Sale.find({}).sort({ saleDate: -1 });
    const hydratedSales = await Promise.all((sales || []).map(s => {
      const pfx = (s && s.shopId && BRANCH_TABLE_PREFIXES[s.shopId]) || 'peshawar_branch';
      return hydrateSaleItems(s, pfx);
    }));
    res.json(hydratedSales);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Payment Ledger & Financial Flow Endpoint (Dynamic for Branches & Super Admin) ──
router.get('/payment-ledger', authenticate, async (req, res) => {
  try {
    const rawShopId = req.query.shopId || (req.user?.role !== 'super_admin' ? (req.user?.shopId?._id || req.user?.shopId) : null);
    let targetShopId = null;
    if (rawShopId && rawShopId !== 'ALL' && rawShopId !== 'all') {
      targetShopId = await resolveShopId(rawShopId) || rawShopId;
    }

    const filter = targetShopId ? { shopId: targetShopId } : {};

    // 1. Fetch Sales from dynamic CustomerPaymentLedger branch table and Sale table
    let salesList = [];
    try {
      let custLedgerRows = [];
      let rawSales = [];

      try {
        custLedgerRows = await CustomerPaymentLedger.find(filter).sort({ date: -1, createdAt: -1 });
      } catch (cplErr) {
        console.warn('CustomerPaymentLedger.find notice:', cplErr.message);
      }

      try {
        rawSales = await Sale.find(filter).sort({ saleDate: -1, createdAt: -1 });
      } catch (sErr) {
        console.warn('Sale.find notice:', sErr.message);
      }

      const salesMap = new Map();
      (rawSales || []).forEach(s => {
        const sId = String(s.id || s._id || '');
        const invNo = String(s.invoiceNumber || '').trim();
        if (sId) salesMap.set(sId, s);
        if (invNo) salesMap.set(invNo, s);
      });

      const seenSaleIds = new Set();

      if (custLedgerRows && custLedgerRows.length > 0) {
        custLedgerRows.forEach(c => {
          const total = Number(c.totalAmount) || 0;
          let cash = Number(c.cashPaid) || 0;
          let bank = Number(c.bankPaid) || 0;
          let due = Number(c.dueAmount) || 0;
          const pMethod = String(c.paymentMethod || 'CASH').toUpperCase();

          if (cash === 0 && bank === 0 && due === 0) {
            if (pMethod === 'CASH') cash = total;
            else if (pMethod.includes('BANK') || pMethod.includes('ONLINE') || pMethod.includes('EASYPAISA')) bank = total;
            else if (pMethod.includes('CREDIT') || pMethod.includes('DUE')) due = total;
            else cash = total;
          }

          const sKey = String(c.saleId || c.invoiceNumber || c.id);
          seenSaleIds.add(String(c.saleId || ''));
          seenSaleIds.add(String(c.invoiceNumber || '').trim());
          if (c.id) seenSaleIds.add(String(c.id));

          const matchingSale = salesMap.get(String(c.saleId || '')) || salesMap.get(String(c.invoiceNumber || '').trim());
          let items = [];
          if (matchingSale && matchingSale.items) {
            items = typeof matchingSale.items === 'string' ? JSON.parse(matchingSale.items) : matchingSale.items;
          } else if (c.items) {
            items = typeof c.items === 'string' ? JSON.parse(c.items) : c.items;
          }
          if (!Array.isArray(items)) items = [];

          let totalPetis = Number(c.petisBought) || 0;
          let totalEggs = Number(c.eggsBought) || 0;

          if (items.length > 0) {
            let petisCount = 0;
            let eggsCount = 0;
            items.forEach(it => {
              const qty = Number(it.quantity) || 1;
              const u = (it.unitLabel || it.unit || '').toLowerCase();
              if (u.includes('peti')) { petisCount += qty; eggsCount += qty * 360; }
              else if (u.includes('tray')) { petisCount += qty / 12; eggsCount += qty * 30; }
              else { eggsCount += qty; petisCount += qty / 360; }
            });
            if (totalPetis === 0) totalPetis = petisCount;
            if (totalEggs === 0) totalEggs = eggsCount;
          } else if (totalPetis === 0 && totalEggs === 0 && total > 0) {
            // Dynamic fallback estimate so it NEVER shows 0 eggs / 0 petis
            totalPetis = Number((total / 1050).toFixed(2)) || 1;
            totalEggs = Math.round(totalPetis * 360);
          }

          let itemsDesc = c.itemsDescription;
          if ((!itemsDesc || itemsDesc === 'Eggs Stock') && items && items.length > 0) {
            itemsDesc = items.map(i => `${i.rawProductName || i.name || 'Eggs'} (${i.quantity || 1} ${i.unitLabel || i.unit || 'x'})`).join(', ');
          }
          if (!itemsDesc) itemsDesc = 'Eggs Stock';

          salesList.push({
            id: c.id,
            shopId: c.shopId,
            saleId: c.saleId,
            date: c.date || c.createdAt,
            invoiceNumber: c.invoiceNumber || `INV-${String(c.saleId || c.id).slice(-5)}`,
            customerName: c.customerName || (due > 0 ? 'Credit Customer' : 'Walk-in Customer'),
            customerPhone: c.customerPhone || '',
            customerEmail: matchingSale?.customerEmail || '',
            totalAmount: total,
            cashPaid: cash,
            bankPaid: bank,
            dueAmount: due,
            paymentMethod: pMethod,
            petisBought: totalPetis > 0 ? Number(totalPetis.toFixed(2)) : 0,
            eggsBought: Math.round(totalEggs),
            itemsDescription: itemsDesc,
            items: items || [],
            category: c.category || (items[0]?.category) || 'Eggs',
            status: c.status || (due === 0 ? 'PAID' : (cash > 0 || bank > 0 ? 'PARTIAL' : 'CREDIT'))
          });
        });
      }

      // Merge any sales from Sale.find that are not already in CustomerPaymentLedger
      (rawSales || [])
        .filter(s => s && s.status !== 'cancelled')
        .forEach(s => {
          const sid = String(s.id || s._id || '');
          const inv = String(s.invoiceNumber || '').trim();
          if ((sid && seenSaleIds.has(sid)) || (inv && seenSaleIds.has(inv))) {
            return; // Already present from custLedgerRows
          }

          const total = Number(s.totalAmount) || 0;
          let cash = Number(s.cashPaid) || 0;
          let bank = Number(s.bankPaid) || 0;
          let due = Number(s.dueAmount) || 0;
          const pMethod = String(s.paymentMethod || 'CASH').toUpperCase();

          if (cash === 0 && bank === 0 && due === 0) {
            if (pMethod === 'CASH') cash = total;
            else if (pMethod.includes('BANK') || pMethod.includes('ONLINE') || pMethod.includes('EASYPAISA')) bank = total;
            else if (pMethod.includes('CREDIT') || pMethod.includes('DUE')) due = total;
            else cash = total;
          }

          let saleItems = [];
          if (Array.isArray(s.items)) {
            saleItems = s.items;
          } else if (typeof s.items === 'string' && s.items.trim()) {
            try { saleItems = JSON.parse(s.items); if (typeof saleItems === 'string') saleItems = JSON.parse(saleItems); } catch { saleItems = []; }
          }
          if (!Array.isArray(saleItems)) saleItems = [];

          let totalPetis = Number(s.petisBought) || 0;
          let totalEggs = Number(s.eggsBought) || 0;
          let itemsDescriptions = [];

          if (saleItems.length > 0) {
            saleItems.forEach(it => {
              const qty = Number(it.quantity) || 1;
              const uType = (it.unit || it.unitType || it.unitLabel || 'peti').toLowerCase();
              let petiCount = 0;
              let eggCount = 0;

              if (uType.includes('peti')) {
                petiCount = qty;
                eggCount = qty * 360;
              } else if (uType.includes('tray')) {
                petiCount = qty / 12;
                eggCount = qty * 30;
              } else {
                petiCount = qty / 360;
                eggCount = qty;
              }

              if (Number(it.petiQuantity) > 0) petiCount = Number(it.petiQuantity);
              if (Number(it.totalEggs) > 0) eggCount = Number(it.totalEggs);

              totalPetis += petiCount;
              totalEggs += eggCount;
              itemsDescriptions.push(`${it.name || it.rawProductName || 'Eggs'} (${qty} ${uType})`);
            });
          } else if (totalPetis === 0 && totalEggs === 0 && total > 0) {
            totalPetis = Number((total / 1050).toFixed(2)) || 1;
            totalEggs = Math.round(totalPetis * 360);
          }

          salesList.push({
            id: s._id || s.id,
            shopId: s.shopId,
            date: s.saleDate || s.createdAt,
            invoiceNumber: s.invoiceNumber || `INV-${String(s.serialNumber || s.id).slice(-5)}`,
            customerName: s.customerName || (due > 0 ? 'Credit Customer' : 'Walk-in Customer'),
            customerPhone: s.customerPhone || '',
            customerEmail: s.customerEmail || '',
            totalAmount: total,
            cashPaid: cash,
            bankPaid: bank,
            dueAmount: due,
            paymentMethod: pMethod,
            petisBought: totalPetis > 0 ? Number(totalPetis.toFixed(2)) : 0,
            eggsBought: Math.round(totalEggs),
            itemsDescription: itemsDescriptions.join(', ') || s.itemsDescription || 'Eggs Stock',
            items: saleItems,
            category: (saleItems.length > 0 && saleItems[0]?.category) || s.category || 'Eggs',
            status: due === 0 ? 'PAID' : (cash > 0 || bank > 0 ? 'PARTIAL' : 'CREDIT')
          });
        });
    } catch (e) {
      console.warn('CustomerPaymentLedger fetch warning:', e.message);
    }

    // 2. Fetch Purchases from dynamic VendorPaymentLedger branch table
    let purchasesList = [];
    try {
      const vndLedgerRows = await VendorPaymentLedger.find(filter).sort({ date: -1, createdAt: -1 });
      if (vndLedgerRows && vndLedgerRows.length > 0) {
        purchasesList = vndLedgerRows.map(p => {
          const totalCost = Number(p.totalCost) || 0;
          const dueAmt = Number(p.dueAmount) || 0;
          let paidAmt = Number(p.amountPaid) || 0;
          if (paidAmt === 0 && totalCost > 0 && dueAmt < totalCost) {
            paidAmt = totalCost - dueAmt;
          }
          let cashAmt = Number(p.cashPaid) || 0;
          let bankAmt = Number(p.bankPaid) || 0;
          const pMethod = String(p.paymentMethod || (dueAmt > 0 && paidAmt === 0 ? 'Credit' : 'Cash')).toUpperCase();

          if (cashAmt === 0 && bankAmt === 0 && paidAmt > 0) {
            if (pMethod.includes('BANK') || pMethod.includes('ONLINE') || pMethod.includes('TRANSFER') || pMethod.includes('EASYPAISA')) {
              bankAmt = paidAmt;
            } else if (pMethod.includes('SPLIT')) {
              cashAmt = Math.floor(paidAmt / 2);
              bankAmt = paidAmt - cashAmt;
            } else {
              cashAmt = paidAmt;
            }
          }

          const petisVal = Number(p.petisPurchased || p.petiQuantity || p.petisCount || 0);
          const traysVal = Number(p.trayQuantity || p.traysCount || (petisVal > 0 ? Math.round(petisVal * 12) : 0));
          const eggsVal = Number(p.eggQuantity || p.totalEggsCount || (petisVal > 0 ? Math.round(petisVal * 360) : 0));

          return {
            id: p.id,
            shopId: p.shopId,
            purchaseId: p.purchaseId,
            date: p.date || p.createdAt,
            createdAt: p.createdAt || p.date,
            supplierName: p.supplierName || 'Farm Vendor',
            supplierPhone: p.supplierPhone || '',
            supplierLocation: p.supplierLocation || '',
            productName: p.productName || 'Eggs Stock',
            category: p.category || 'Eggs',
            petisPurchased: petisVal,
            petiQuantity: petisVal,
            petisCount: petisVal,
            trayQuantity: traysVal,
            traysCount: traysVal,
            eggQuantity: eggsVal,
            totalEggsCount: eggsVal,
            quantityText: p.quantityText || '',
            unitType: p.unitType || 'peti',
            buyCost: Number(p.buyCost) || 0,
            totalCost: Math.round(totalCost),
            amountPaid: Math.round(paidAmt),
            cashPaid: Math.round(cashAmt),
            bankPaid: Math.round(bankAmt),
            dueAmount: Math.round(dueAmt),
            paymentMethod: pMethod,
            status: p.status || (dueAmt === 0 ? 'PAID' : (paidAmt > 0 ? 'PARTIAL' : 'CREDIT'))
          };
        });
      }
    } catch (e) {
      console.warn('VendorPaymentLedger fetch warning:', e.message);
    }

    // Fallback to Purchase.find and Item.find if branch table is empty
    if (purchasesList.length === 0) {
      let rawPurchases = [];
      let rawItems = [];
      try {
        rawPurchases = await Purchase.find(filter).sort({ purchaseDate: -1, createdAt: -1 });
      } catch (pErr) {
        console.warn('Purchase.find notice:', pErr.message);
      }
      try {
        rawItems = await Item.find(filter).sort({ createdAt: -1 });
      } catch (iErr) {
        console.warn('Item.find notice:', iErr.message);
      }

      const itemMap = new Map();
      (rawItems || []).forEach(it => {
        const itId = it.id || it._id;
        if (itId) itemMap.set(String(itId), it);
      });

      const seenItemIds = new Set();

      (rawPurchases || []).forEach(p => {
        const pId = p.id || p._id;
        const itId = p.itemId ? String(p.itemId) : null;
        if (itId) seenItemIds.add(itId);

        const matchingItem = itId ? itemMap.get(itId) : null;

        const totalCost = Number(p.totalCost) || (Number(matchingItem?.totalPurchaseCost) || 0);
        let dueAmt = Number(p.dueAmount);
        if (isNaN(dueAmt) || dueAmt < 0) {
          dueAmt = matchingItem?.dueAmountToSupplier !== undefined ? Number(matchingItem.dueAmountToSupplier) : 0;
        }

        let paidAmt = Number(p.amountPaid);
        if (isNaN(paidAmt) || paidAmt < 0) {
          paidAmt = Math.max(0, totalCost - dueAmt);
        }

        let cashAmt = Number(matchingItem?.cashPaidToSupplier) || 0;
        let bankAmt = Number(matchingItem?.bankPaidToSupplier) || 0;

        const pType = String(p.paymentType || matchingItem?.paymentMethod || 'Cash').toLowerCase();

        if (cashAmt === 0 && bankAmt === 0 && paidAmt > 0) {
          if (pType.includes('bank') || pType.includes('online') || pType.includes('transfer') || pType.includes('easy')) {
            bankAmt = paidAmt;
          } else if (pType.includes('split')) {
            cashAmt = Math.floor(paidAmt / 2);
            bankAmt = paidAmt - cashAmt;
          } else {
            cashAmt = paidAmt;
          }
        }

        let petiQty = Number(p.petiQuantity) > 0
          ? Number(p.petiQuantity)
          : (matchingItem?.petiQuantity > 0 ? Number(matchingItem.petiQuantity) : (Number(p.eggQuantity) > 0 ? Number((p.eggQuantity / 360).toFixed(2)) : 0));
        let trayQty = Number(p.trayQuantity) > 0
          ? Number(p.trayQuantity)
          : (matchingItem?.trayQuantity > 0 ? Number(matchingItem.trayQuantity) : 0);
        let eggQty = Number(p.eggQuantity) > 0
          ? Number(p.eggQuantity)
          : (matchingItem?.eggQuantity > 0 ? Number(matchingItem.eggQuantity) : (Number(matchingItem?.stock) || 0));

        if (petiQty > 0 && trayQty === 0) trayQty = Math.round(petiQty * 12);
        if (petiQty > 0 && eggQty === 0) eggQty = Math.round(petiQty * 360);
        if (trayQty > 0 && eggQty === 0) eggQty = Math.round(trayQty * 30);
        if (eggQty > 0 && petiQty === 0) petiQty = Number((eggQty / 360).toFixed(2));
        if (eggQty > 0 && trayQty === 0) trayQty = Math.round(eggQty / 30);

        // Deduct sold stock from purchase volume to get net in-hand remaining stock
        const currentEggs = matchingItem && matchingItem.stock !== undefined ? Number(matchingItem.stock) : eggQty;
        const remainingPetis = matchingItem && matchingItem.petiQuantity !== undefined ? Number(matchingItem.petiQuantity) : Number((currentEggs / 360).toFixed(2));
        const remainingTrays = matchingItem && matchingItem.trayQuantity !== undefined ? Number(matchingItem.trayQuantity) : Math.round(currentEggs / 30);
        const soldEggs = Math.max(0, eggQty - currentEggs);
        const soldPetis = Number((soldEggs / 360).toFixed(2));

        purchasesList.push({
          id: pId,
          shopId: p.shopId,
          date: p.purchaseDate || p.createdAt,
          createdAt: p.createdAt || p.purchaseDate,
          supplierName: p.supplierName || matchingItem?.supplierName || 'Farm Vendor',
          supplierPhone: p.supplierPhone || matchingItem?.supplierPhone || '',
          supplierLocation: p.supplierLocation || matchingItem?.supplierLocation || '',
          productName: p.productName || matchingItem?.name || 'Eggs Stock',
          category: p.category || matchingItem?.category || 'Eggs',
          petisPurchased: Number(petiQty) || 0,
          totalPurchasedEggs: Number(eggQty) || 0,
          petiQuantity: remainingPetis, // Net purchase product minus sold product
          petisCount: remainingPetis,
          trayQuantity: remainingTrays,
          traysCount: remainingTrays,
          eggQuantity: currentEggs,
          stock: currentEggs,
          remainingStock: currentEggs,
          remainingPetis,
          remainingTrays,
          soldQuantity: soldPetis,
          soldEggs,
          totalEggsCount: currentEggs,
          quantityText: p.quantityText || matchingItem?.quantityText || '',
          unitType: p.unitType || 'peti',
          buyCost: Number(p.buyCost) || Number(matchingItem?.costPrice) || 0,
          totalCost: Math.round(totalCost),
          amountPaid: Math.round(paidAmt),
          cashPaid: Math.round(cashAmt),
          bankPaid: Math.round(bankAmt),
          dueAmount: Math.round(dueAmt),
          paymentMethod: p.paymentType || matchingItem?.paymentMethod || (dueAmt > 0 ? 'Credit' : 'Cash'),
          status: dueAmt === 0 ? 'PAID' : (paidAmt > 0 ? 'PARTIAL' : 'CREDIT')
        });
      });

      // Also include any items that weren't captured in purchases table
      (rawItems || []).forEach(it => {
        const itId = String(it.id || it._id);
        if (!seenItemIds.has(itId) && (Number(it.totalPurchaseCost) > 0 || Number(it.petiQuantity) > 0 || Number(it.stock) > 0)) {
          const totalCost = Number(it.totalPurchaseCost) || (Number(it.petiQuantity || 0) * Number(it.costPrice || 0));
          const dueAmt = Number(it.dueAmountToSupplier) || 0;
          const paidAmt = Number(it.amountPaidToSupplier) || Math.max(0, totalCost - dueAmt);
          let cashAmt = Number(it.cashPaidToSupplier) || 0;
          let bankAmt = Number(it.bankPaidToSupplier) || 0;
          const pMethod = String(it.paymentMethod || 'Cash').toLowerCase();

          if (cashAmt === 0 && bankAmt === 0 && paidAmt > 0) {
            if (pMethod.includes('bank') || pMethod.includes('online')) bankAmt = paidAmt;
            else cashAmt = paidAmt;
          }

          let petiQty = Number(it.petiQuantity) || (Number(it.stock) > 0 ? Number((it.stock / 360).toFixed(2)) : 0);
          let trayQty = Number(it.trayQuantity) || 0;
          let eggQty = Number(it.eggQuantity) || Number(it.stock) || 0;

          if (petiQty > 0 && trayQty === 0) trayQty = Math.round(petiQty * 12);
          if (petiQty > 0 && eggQty === 0) eggQty = Math.round(petiQty * 360);
          if (trayQty > 0 && eggQty === 0) eggQty = Math.round(trayQty * 30);
          if (eggQty > 0 && petiQty === 0) petiQty = Number((eggQty / 360).toFixed(2));
          if (eggQty > 0 && trayQty === 0) trayQty = Math.round(eggQty / 30);

          const currentEggs = Number(it.stock !== undefined ? it.stock : it.eggQuantity) || 0;
          const remainingPetis = Number(it.petiQuantity) || Number((currentEggs / 360).toFixed(2));
          const remainingTrays = Number(it.trayQuantity) || Math.round(currentEggs / 30);
          const initialEggs = Math.max(currentEggs, Number(it.eggQuantity || 0), (Number(petiQty) * 360));
          const soldEggs = Math.max(0, initialEggs - currentEggs);
          const soldPetis = Number((soldEggs / 360).toFixed(2));

          purchasesList.push({
            id: `item-${itId}`,
            shopId: it.shopId,
            date: it.createdAt,
            createdAt: it.createdAt,
            supplierName: it.supplierName || 'Farm Vendor',
            supplierPhone: it.supplierPhone || '',
            supplierLocation: it.supplierLocation || '',
            productName: it.name || 'Eggs Stock',
            category: it.category || 'Eggs',
            petisPurchased: Number(petiQty) || 0,
            totalPurchasedEggs: initialEggs,
            petiQuantity: remainingPetis, // Subtracted sold product from purchase product
            petisCount: remainingPetis,
            trayQuantity: remainingTrays,
            traysCount: remainingTrays,
            eggQuantity: currentEggs,
            stock: currentEggs,
            remainingStock: currentEggs,
            remainingPetis,
            remainingTrays,
            soldQuantity: soldPetis,
            soldEggs,
            totalEggsCount: currentEggs,
            quantityText: it.quantityText || '',
            unitType: it.unitType || 'peti',
            buyCost: Number(it.costPrice) || 0,
            totalCost: Math.round(totalCost),
            amountPaid: Math.round(paidAmt),
            cashPaid: Math.round(cashAmt),
            bankPaid: Math.round(bankAmt),
            dueAmount: Math.round(dueAmt),
            paymentMethod: it.paymentMethod || (dueAmt > 0 ? 'Credit' : 'Cash'),
            status: dueAmt === 0 ? 'PAID' : (paidAmt > 0 ? 'PARTIAL' : 'CREDIT')
          });
        }
      });
    }

    purchasesList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    // 3. Compute High-Level Totals
    const customerTotalRevenue = salesList.reduce((acc, s) => acc + s.totalAmount, 0);
    const totalCashReceived = salesList.reduce((acc, s) => acc + s.cashPaid, 0);
    const totalBankReceived = salesList.reduce((acc, s) => acc + s.bankPaid, 0);
    const customerCreditDueTotal = salesList.reduce((acc, s) => acc + s.dueAmount, 0);
    const totalCustomerPetisSold = salesList.reduce((acc, s) => acc + s.petisBought, 0);
    const totalPaymentsCollected = totalCashReceived + totalBankReceived;

    const supplierTotalCost = purchasesList.reduce((acc, p) => acc + p.totalCost, 0);
    const supplierCashPaid = purchasesList.reduce((acc, p) => acc + p.cashPaid, 0);
    const supplierBankPaid = purchasesList.reduce((acc, p) => acc + p.bankPaid, 0);
    const supplierCreditDueTotal = purchasesList.reduce((acc, p) => acc + p.dueAmount, 0);
    const totalSupplierPetisBought = purchasesList.reduce((acc, p) => acc + p.petisPurchased, 0);
    const totalSupplierPaid = supplierCashPaid + supplierBankPaid;

    const netCashFlow = totalCashReceived - supplierCashPaid;
    const netBankFlow = totalBankReceived - supplierBankPaid;
    const netTotalFlow = totalPaymentsCollected - totalSupplierPaid;

    res.json({
      success: true,
      shopId: targetShopId,
      summary: {
        totalPaymentsCollected,
        totalCashReceived,
        totalBankReceived,
        customerCreditDueTotal,
        customerTotalRevenue,
        totalCustomerPetisSold,
        salesCount: salesList.length,

        supplierTotalCost,
        supplierCashPaid,
        supplierBankPaid,
        supplierCreditDueTotal,
        totalSupplierPaid,
        totalSupplierPetisBought,
        purchasesCount: purchasesList.length,

        netCashFlow,
        netBankFlow,
        netTotalFlow
      },
      sales: salesList,
      purchases: purchasesList
    });
  } catch (err) {
    console.error('[payment-ledger API error]:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all sales (shop admin - their shop only)
router.get('/', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const rawShopId = req.query.shopId || (req.user && req.user.shopId);
    let filter = {};
    let targetShopId = null;
    if (rawShopId) {
      targetShopId = await resolveShopId(rawShopId);
      if (targetShopId) {
        filter = { shopId: targetShopId };
      }
    }
    const sales = await Sale.find(filter).sort({ saleDate: -1 });
    const pfx = (targetShopId && BRANCH_TABLE_PREFIXES[targetShopId]) || (rawShopId && BRANCH_TABLE_PREFIXES[rawShopId]) || 'peshawar_branch';
    const hydratedSales = await Promise.all((sales || []).map(s => hydrateSaleItems(s, pfx)));
    res.json(hydratedSales);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper function to create sale record with custom payment routing
const createSaleRecord = async (req, res, explicitPaymentData = {}) => {
  const { items, totalAmount, totalProfit, cashierName, customerName, shopId } = req.body;
  const rawShopId = req.user?.shopId || shopId;
  const targetShopId = await resolveShopId(rawShopId) || 1;
  
  try {
    // 0. Super Admin permission check for Walk-In Billing
    const isApproved = await checkBranchApproval(req, 'edit', 'walkin');
    if (!isApproved) {
      return res.status(403).json({
        success: false,
        message: '🔒 Walk-In Billing is locked by Super Admin for this branch. Operation not allowed.'
      });
    }

    // 1. Fetch current settings for the invoice
    let settings = await Settings.findOne({ shopId: targetShopId });
    if (!settings) {
      try {
        settings = await Settings.create({ shopId: targetShopId });
      } catch (sErr) {
        settings = { shopId: targetShopId };
      }
    }

    // 2. Resolve Payment Breakdown (Cash, Bank, Credit)
    const method = String(explicitPaymentData.paymentMethod || req.body.paymentMethod || 'CASH').toUpperCase();
    const isBank = method === 'BANK_TRANSFER' || method === 'BANK' || method === 'ONLINE' || method === 'EASYPAISA';
    const isCredit = method === 'CREDIT' || method === 'DUE' || explicitPaymentData.isCredit === true;

    const totalAmt = Number(totalAmount) || 0;
    let cashPaid = 0;
    let bankPaid = 0;
    let dueAmount = 0;

    if (req.body.cashPaid !== undefined || req.body.bankPaid !== undefined || req.body.dueAmount !== undefined) {
      cashPaid = Math.max(0, Number(req.body.cashPaid) || 0);
      bankPaid = Math.max(0, Number(req.body.bankPaid) || 0);
      if (req.body.dueAmount !== undefined) {
        dueAmount = Math.max(0, Number(req.body.dueAmount) || 0);
      } else {
        dueAmount = Math.max(0, totalAmt - (cashPaid + bankPaid));
      }
    } else if (method === 'CASH') {
      cashPaid = totalAmt;
      dueAmount = 0;
    } else if (isBank) {
      bankPaid = totalAmt;
      dueAmount = 0;
    } else if (isCredit) {
      dueAmount = totalAmt;
      cashPaid = 0;
      bankPaid = 0;
    } else if (method === 'SPLIT' || method === 'PARTIAL') {
      cashPaid = Number(req.body.cashPaid) || 0;
      bankPaid = Number(req.body.bankPaid) || 0;
      dueAmount = Math.max(0, totalAmt - (cashPaid + bankPaid));
    } else {
      cashPaid = totalAmt;
      dueAmount = 0;
    }

    const paymentReceipt = req.body.paymentReceipt || req.body.paymentProof || explicitPaymentData.paymentReceipt || '';

    // Generate unique serial number
    let existingCount = 0;
    try {
      existingCount = await Sale.countDocuments({ shopId: targetShopId });
    } catch (cErr) { }
    const saleItems = Array.isArray(items) ? items : (typeof items === 'string' ? JSON.parse(items || '[]') : []);

    // ── STRICT DYNAMIC STOCK VALIDATION (Online Server & POS Enforcement) ──
    // Prevent sales when product is low stock or out of stock (stock <= 0 or requested > available)
    for (const it of saleItems) {
      const prodId = it.productId || it.itemId || it._id || it.id;
      if (prodId) {
        const product = await Item.findById(prodId);
        if (product) {
          const availStock = Number(product.stock) || 0;
          const qty = Number(it.quantity) || 1;
          const uType = String(it.unitLabel || it.unit || it.unitType || product.unitType || 'peti').toLowerCase();
          const tPerP = Number(product.traysPerPeti) || 12;
          const ePerT = Number(product.eggsPerTray) || 30;
          const ePerP = tPerP * ePerT || 360;

          let eggsRequired = 0;
          if (Number(it.totalEggs) > 0) {
            eggsRequired = Number(it.totalEggs);
          } else if (uType.includes('peti')) {
            eggsRequired = qty * ePerP;
          } else if (uType.includes('tray')) {
            eggsRequired = qty * ePerT;
          } else {
            eggsRequired = qty;
          }

          if (availStock <= 0) {
            return res.status(400).json({
              success: false,
              message: `Cannot complete sale: Product "${product.name}" is completely Out of Stock (0 remaining). Please restock before selling.`
            });
          }

          if (eggsRequired > availStock) {
            const availPetis = (availStock / ePerP).toFixed(1);
            return res.status(400).json({
              success: false,
              message: `Cannot complete sale: Insufficient stock for "${product.name}". Available: ${availStock} eggs (${availPetis} Petis), but requested ${eggsRequired} eggs. Please adjust quantity or restock.`
            });
          }
        }
      }
    }
    const serialNumber = 1 + existingCount;
    const invoiceNumber = req.body.invoiceNumber || explicitPaymentData.invoiceNumber || (settings?.invoicePrefix ? `${settings.invoicePrefix}-${String(serialNumber).padStart(5, '0')}` : `INV-${String(serialNumber).padStart(5, '0')}`);
    let computedPetis = 0;
    let computedEggs = 0;
    const descParts = [];

    for (const it of saleItems) {
      const qty = Number(it.quantity) || 1;
      const uType = (it.unitLabel || it.unit || it.unitType || 'peti').toLowerCase();
      const nm = it.rawProductName || it.name || 'Eggs';
      let petis = 0;
      let eggs = 0;
      if (uType.includes('peti')) {
        petis = qty;
        eggs = qty * 360;
      } else if (uType.includes('tray')) {
        petis = qty / 12;
        eggs = qty * 30;
      } else {
        eggs = Number(it.totalEggs) > 0 ? Number(it.totalEggs) : qty;
        petis = eggs / 360;
      }
      if (Number(it.petiQuantity) > 0) petis = Number(it.petiQuantity);
      if (Number(it.totalEggs) > 0) eggs = Number(it.totalEggs);
      computedPetis += petis;
      computedEggs += eggs;
      descParts.push(`${nm} (${qty} ${uType})`);
    }

    if (computedPetis === 0 && computedEggs === 0 && totalAmt > 0) {
      computedPetis = Number((totalAmt / 1050).toFixed(2)) || 1;
      computedEggs = Math.round(computedPetis * 360);
    }

    const itemsDesc = descParts.join(', ') || req.body.itemsDescription || 'Eggs Stock';
    const mainCategory = (saleItems[0]?.category) || req.body.category || 'Eggs';

    const salePayload = {
      shopId: targetShopId,
      items: saleItems,
      totalAmount: totalAmt,
      totalProfit: Number(totalProfit) || 0,
      serialNumber,
      invoiceNumber,
      itemsDescription: itemsDesc,
      petisBought: Number(computedPetis.toFixed(2)),
      eggsBought: Math.round(computedEggs),
      category: mainCategory,
      cashierName: cashierName || req.user?.fullName || "Shop Admin",
      customerName: customerName || (isCredit ? "Credit Customer" : "Walk-in Customer"),
      customerPhone: req.body.customerPhone || "",
      customerEmail: req.body.customerEmail || "",
      customerId: req.body.customerId || null,
      paymentMethod: method,
      cashPaid,
      bankPaid,
      dueAmount,
      paymentReceipt,
      paymentProof: paymentReceipt,
      transactionId: req.body.transactionId || "",
      isCredit: isCredit || dueAmount > 0,
      approvalStatus: req.body.approvalStatus || (isBank ? 'PENDING_APPROVAL' : 'APPROVED'),
      saleDate: new Date()
    };
    
    // Automatically register walk-in customer in database if name is provided
    let finalCustomerName = salePayload.customerName;
    const isGeneric = !finalCustomerName || finalCustomerName.toLowerCase() === 'walk-in customer' || finalCustomerName.toLowerCase() === 'walk-in' || finalCustomerName.toLowerCase() === 'cash customer';
    
    if (!isGeneric && !salePayload.customerId) {
      try {
        const existingCust = await Customer.findOne({ fullName: finalCustomerName, shopId: targetShopId });
        if (!existingCust) {
          const cleanPhone = (salePayload.customerPhone || '').replace(/\D/g, '');
          const cleanName = finalCustomerName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const fallbackEmail = salePayload.customerEmail || `${cleanName || 'cust'}_${cleanPhone || Date.now()}@walkin.local`;
          const newCust = await Customer.create({
            fullName: finalCustomerName,
            phone: salePayload.customerPhone || '',
            email: fallbackEmail,
            password: 'phys_' + Math.random().toString(36).substring(7), // dummy password for physical
            shopId: targetShopId
          });
          salePayload.customerId = newCust._id || newCust.id;
        } else {
          salePayload.customerId = existingCust._id || existingCust.id;
        }
      } catch (custErr) {
        console.error('Failed to auto-register walk-in customer:', custErr);
      }
    }
    
    // 3. Update stock for each item if items provided
    if (Array.isArray(saleItems) && saleItems.length > 0) {
      for (const item of saleItems) {
        const prodId = item.productId || item.itemId || item._id || item.id;
        if (prodId) {
          const product = await Item.findById(prodId);
          if (product) {
            const qty = Number(item.quantity) || 1;
            const uType = String(item.unitLabel || item.unit || item.unitType || product.unitType || 'peti').toLowerCase();
            const tPerP = Number(product.traysPerPeti) || 12;
            const ePerT = Number(product.eggsPerTray) || 30;
            const ePerP = tPerP * ePerT || 360;

            let stockToDeduct = 0;
            if (Number(item.totalEggs) > 0) {
              stockToDeduct = Number(item.totalEggs);
            } else if (uType.includes('peti')) {
              stockToDeduct = qty * ePerP;
            } else if (uType.includes('tray')) {
              stockToDeduct = qty * ePerT;
            } else {
              stockToDeduct = qty;
            }

            const newStock = Math.max(0, (Number(product.stock) || 0) - stockToDeduct);
            const newPetis = Math.max(0, Number((newStock / ePerP).toFixed(2)));
            const newTrays = Math.max(0, Math.round(newStock / ePerT));
            
            const itemUpdate = {
              stock: newStock,
              petiQuantity: newPetis,
              trayQuantity: newTrays,
              eggQuantity: newStock,
              lastUpdated: new Date().toISOString().split('T')[0]
            };

            await Item.findByIdAndUpdate(product.id || product._id, itemUpdate);

            // Also update purchases table if a purchase row exists for this itemId
            try {
              const pIdVal = Number(product.id || product._id);
              if (pIdVal) {
                await pool.query(
                  'UPDATE purchases SET petiQuantity = ?, trayQuantity = ?, eggQuantity = ? WHERE itemId = ?',
                  [newPetis, newTrays, newStock, pIdVal]
                );
              }
            } catch (_) {}
          }
        }
      }
    }
    
    const newSale = await Sale.create(salePayload);

    // Auto-create CustomerPaymentLedger record for EVERY sale (online & local dynamic tracking)
    if (newSale) {
      try {
        const cplDue = Number(newSale.dueAmount) || 0;
        const cplCash = Number(newSale.cashPaid) || 0;
        const cplBank = Number(newSale.bankPaid) || 0;
        const cplStatus = cplDue <= 0 ? 'PAID' : (cplCash > 0 || cplBank > 0 ? 'PARTIAL' : 'CREDIT');

        await CustomerPaymentLedger.create({
          shopId: targetShopId,
          saleId: String(newSale.id || newSale._id),
          invoiceNumber: newSale.invoiceNumber || invoiceNumber,
          date: newSale.saleDate || new Date(),
          customerName: newSale.customerName || 'Walk-in Customer',
          customerPhone: newSale.customerPhone || '',
          customerEmail: newSale.customerEmail || '',
          totalAmount: totalAmt,
          cashPaid: cplCash,
          bankPaid: cplBank,
          dueAmount: cplDue,
          paymentMethod: method,
          petisBought: Number(computedPetis.toFixed(2)),
          eggsBought: Math.round(computedEggs),
          itemsDescription: itemsDesc,
          items: saleItems,
          category: mainCategory,
          status: cplStatus
        });

        // Automatically sync into branch sale_product_history and today_sales_history tables
        await syncSaleToBranchHistories(newSale, targetShopId);

        // Also insert into sale_items table if present for multi-table compatibility
        const sIdNum = Number(newSale.id || newSale._id);
        if (sIdNum && Array.isArray(saleItems) && saleItems.length > 0) {
          const branchPfx = (targetShopId && BRANCH_TABLE_PREFIXES[targetShopId]) || 'peshawar_branch';
          for (const item of saleItems) {
            const pId = Number(item.productId || item.itemId || item.id) || null;
            const qty = Number(item.quantity) || 1;
            const pr = Number(item.price) || 0;
            const cp = Number(item.costPrice) || 0;
            const sub = Number(item.subtotal) || (qty * pr);
            const prof = Number(item.profit) || Math.max(0, sub - (qty * cp));
            const itemName = item.rawProductName || item.name || 'Eggs';

            await pool.query(
              `INSERT INTO \`${branchPfx}__sale_items\` (saleId, productId, name, quantity, price, costPrice, subtotal, profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [sIdNum, pId, itemName, qty, pr, cp, sub, prof]
            ).catch(async () => {
              await pool.query(
                `INSERT INTO \`sale_items\` (saleId, productId, name, quantity, price, costPrice, subtotal, profit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [sIdNum, pId, itemName, qty, pr, cp, sub, prof]
              ).catch(() => {});
            });
          }
        }
      } catch (cplErr) {
        console.warn('[createSaleRecord] CustomerPaymentLedger creation notice:', cplErr.message);
      }
    }

    // Auto-create CustomerCredit record if sale has due balance or is credit
    if (newSale && (Number(newSale.dueAmount) > 0 || newSale.isCredit)) {
      try {
        const total = Number(newSale.totalAmount || 0);
        const paid = (Number(newSale.cashPaid) || 0) + (Number(newSale.bankPaid) || 0);
        const due = Number(newSale.dueAmount || 0);
        const status = due <= 0 ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'UNPAID');

        await CustomerCredit.create({
          shopId: newSale.shopId,
          customerId: newSale.customerId || null,
          saleId: newSale.id || newSale._id,
          customerName: newSale.customerName || 'Credit Customer',
          customerPhone: newSale.customerPhone || '',
          customerEmail: newSale.customerEmail || '',
          totalAmount: total,
          paidAmount: paid,
          dueAmount: due,
          status: status,
          notes: newSale.invoiceNumber || '',
          paymentMethod: newSale.paymentMethod || 'CASH'
        });
      } catch (ccErr) {
        console.error('[createSaleRecord] CustomerCredit creation error:', ccErr.message);
      }
    }

    // 4. Update active CashSession
    if (cashPaid > 0) {
      try {
        const activeSession = await CashSession.findOne({ status: 'open' });
        if (activeSession) {
          await CashSession.findByIdAndUpdate(activeSession.id, {
            totalSales: (Number(activeSession.totalSales) || 0) + cashPaid,
            expectedCash: (Number(activeSession.expectedCash) || 0) + cashPaid
          });
        }
      } catch (csErr) { }
    }

    // 5. Generate PDF Invoice
    const fileName = `invoice-${newSale._id || newSale.id}.pdf`;
    const invoicesDir = path.join(__dirname, '..', 'invoices');
    if (!fs.existsSync(invoicesDir)) {
      fs.mkdirSync(invoicesDir, { recursive: true });
    }
    const filePath = path.join(invoicesDir, fileName);
    
    try {
      await generateInvoice(newSale, filePath, settings);
      const responseData = typeof newSale.toObject === 'function' ? newSale.toObject() : { ...newSale };
      responseData.invoiceUrl = `/invoices/${fileName}`;
      res.status(201).json(responseData);
    } catch (pdfErr) {
      const responseData = typeof newSale.toObject === 'function' ? newSale.toObject() : { ...newSale };
      res.status(201).json(responseData);
    }
  } catch (err) {
    console.error('[createSaleRecord error]:', err);
    res.status(500).json({ message: err.message });
  }
};

// Create a standard sale
router.post('/', authenticate, requireShopAdmin, async (req, res) => {
  await createSaleRecord(req, res);
});

// ── DEDICATED ROUTE 1: CASH SALE ──
router.post('/cash', authenticate, requireShopAdmin, async (req, res) => {
  await createSaleRecord(req, res, { paymentMethod: 'CASH' });
});

// ── DEDICATED ROUTE 2: BANK / ONLINE SALE WITH RECEIPT PROOF ──
router.post('/bank', authenticate, requireShopAdmin, async (req, res) => {
  await createSaleRecord(req, res, { paymentMethod: 'BANK_TRANSFER' });
});

router.post('/online', authenticate, requireShopAdmin, async (req, res) => {
  await createSaleRecord(req, res, { paymentMethod: 'ONLINE' });
});

// ── DEDICATED ROUTE 3: CREDIT (DUE BALANCE) SALE ──
router.post('/credit', authenticate, requireShopAdmin, async (req, res) => {
  await createSaleRecord(req, res, { paymentMethod: 'CREDIT', isCredit: true });
});

router.post('/due', authenticate, requireShopAdmin, async (req, res) => {
  await createSaleRecord(req, res, { paymentMethod: 'CREDIT', isCredit: true });
});

// ── SALES BREAKDOWN & SUMMARY ROUTE (Cash, Bank, Credit) ──
router.get('/breakdown/:shopId?', authenticate, async (req, res) => {
  try {
    const rawShopId = req.params.shopId || req.query.shopId || req.user?.shopId;
    let filter = {};
    if (rawShopId) {
      const targetShopId = await resolveShopId(rawShopId);
      if (targetShopId) {
        filter = { shopId: targetShopId };
      }
    }
    const allSales = await Sale.find(filter);

    let totalCash = 0;
    let totalBank = 0;
    let totalCredit = 0;
    let totalGrossSales = 0;

    allSales.forEach(s => {
      totalGrossSales += (Number(s.totalAmount) || 0);
      if (s.cashPaid !== undefined || s.bankPaid !== undefined || s.dueAmount !== undefined) {
        totalCash += (Number(s.cashPaid) || 0);
        totalBank += (Number(s.bankPaid) || 0);
        totalCredit += (Number(s.dueAmount) || 0);
      } else {
        // Fallback for older sales
        const m = String(s.paymentMethod || 'CASH').toUpperCase();
        if (m === 'CASH') totalCash += (Number(s.totalAmount) || 0);
        else if (m === 'BANK_TRANSFER' || m === 'BANK' || m === 'ONLINE' || m === 'EASYPAISA') totalBank += (Number(s.totalAmount) || 0);
        else if (m === 'CREDIT' || m === 'DUE') totalCredit += (Number(s.totalAmount) || 0);
        else totalCash += (Number(s.totalAmount) || 0);
      }
    });

    res.json({
      success: true,
      totalGrossSales,
      totalCash,
      totalBank,
      totalCredit,
      totalCount: allSales.length
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── TODAY DAILY FINANCIAL SUMMARY ROUTE (Strictly deducts expenses, fuel, damage from Today Sale only) ──
router.get('/today-financial-summary/:shopId?', authenticate, async (req, res) => {
  try {
    const rawShopId = req.params.shopId || req.query.shopId || req.user?.shopId || 1;
    const targetShopId = await resolveShopId(rawShopId) || 1;
    const targetDate = req.query.date || null;
    const summary = await getBranchTodayFinancialSummary(targetShopId, targetDate);
    return res.json(summary);
  } catch (err) {
    console.error('Error fetching today financial summary:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET SALES FILTERED BY TYPE (cash | bank | credit) ──
router.get('/by-type/:type', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const type = req.params.type.toLowerCase();
    const rawShopId = req.query.shopId || req.user?.shopId;
    let filter = {};
    if (rawShopId) {
      const targetShopId = await resolveShopId(rawShopId);
      if (targetShopId) {
        filter.shopId = targetShopId;
      }
    }

    if (type === 'cash') {
      filter.$or = [{ paymentMethod: 'CASH' }, { cashPaid: { $gt: 0 } }];
    } else if (type === 'bank' || type === 'online') {
      filter.$or = [{ paymentMethod: { $in: ['BANK_TRANSFER', 'BANK', 'ONLINE', 'EASYPAISA'] } }, { bankPaid: { $gt: 0 } }];
    } else if (type === 'credit' || type === 'due') {
      filter.$or = [{ paymentMethod: { $in: ['CREDIT', 'DUE'] } }, { isCredit: true }, { dueAmount: { $gt: 0 } }];
    }

    const sales = await Sale.find(filter).sort({ saleDate: -1 });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Return a sale (and reverse stock)
router.put('/:id/return', authenticate, requireShopAdmin, async (req, res) => {
  const { reason } = req.body;
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale || sale.status === 'returned') {
      return res.status(404).json({ message: 'Sale not found or already returned' });
    }

    // 1. Reverse stock for each item
    for (const item of (sale.items || [])) {
      const pId = item.productId || item.id || item._id;
      if (pId) {
        const product = await Item.findById(pId);
        if (product) {
          const qty = Number(item.quantity) || 1;
          const stockToAdd = Number(item.totalEggs) > 0 ? Number(item.totalEggs) : qty;
          const newStock = (Number(product.stock) || 0) + stockToAdd;
          const updateObj = { stock: newStock, lastUpdated: new Date().toISOString().split('T')[0] };
          if (product.unitType === 'peti') {
            updateObj.petiQuantity = (Number(product.petiQuantity) || 0) + qty;
          } else if (product.unitType === 'tray') {
            updateObj.trayQuantity = (Number(product.trayQuantity) || 0) + qty;
          } else if (product.unitType === 'egg') {
            updateObj.eggQuantity = newStock;
          }
          await Item.findByIdAndUpdate(product.id, updateObj);
        }
      }
    }

    // 2. Update sale record in MySQL
    const updatedSale = await Sale.findByIdAndUpdate(sale.id, {
      status: 'returned',
      returnReason: reason || "Customer Return",
      returnDate: new Date()
    }, { new: true });

    // 3. Update active CashSession
    if (Number(sale.cashPaid) > 0) {
      try {
        const activeSession = await CashSession.findOne({ status: 'open' });
        if (activeSession) {
          await CashSession.findByIdAndUpdate(activeSession.id, {
            totalReturns: (Number(activeSession.totalReturns) || 0) + Number(sale.cashPaid),
            expectedCash: Math.max(0, (Number(activeSession.expectedCash) || 0) - Number(sale.cashPaid))
          });
        }
      } catch (e) { }
    }

    res.json(updatedSale);
  } catch (err) {
    console.error('Return sale error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Edit a sale (and adjust stock)
router.put('/:id', authenticate, requireShopAdmin, async (req, res) => {
  const canEdit = await checkBranchApproval(req, 'edit');
  if (!canEdit) {
    return res.status(403).json({ message: "🔒 Super Admin Approval Required: Edit actions are locked for this branch." });
  }
  const { items, totalAmount, totalProfit, customerName, customerPhone, customerEmail, paymentMethod, cashPaid, bankPaid, dueAmount, saleDate, invoiceNumber } = req.body;
  try {
    const targetId = req.params.id;
    let sale = await Sale.findById(targetId);
    if (!sale && String(targetId).startsWith('cpl-')) {
      const rawId = String(targetId).replace('cpl-', '');
      sale = await Sale.findById(rawId);
    }
    if (!sale) {
      sale = await Sale.findOne({ invoiceNumber: targetId });
    }
    if (!sale) {
      sale = await Sale.findOne({ orderId: targetId });
    }
    if (!sale && (req.query?.invoiceNumber || req.body?.invoiceNumber)) {
      const inv = req.query?.invoiceNumber || req.body?.invoiceNumber;
      sale = await Sale.findOne({ invoiceNumber: inv });
    }
    if (!sale && (req.query?.saleId || req.body?.saleId)) {
      const sid = req.query?.saleId || req.body?.saleId;
      sale = await Sale.findById(sid);
    }
    if (!sale) {
      // Look up targetId in branch customer payment ledger tables to find saleId or invoiceNumber
      for (const pfx of (await getAllBranchPrefixesList())) {
        try {
          const [ledgerRows] = await pool.query(
            `SELECT saleId, invoiceNumber FROM \`${pfx}__customer_payment_ledger\` WHERE \`id\` = ? OR \`saleId\` = ? OR \`invoiceNumber\` = ? LIMIT 1`,
            [targetId, targetId, targetId]
          );
          if (ledgerRows && ledgerRows.length > 0) {
            const row = ledgerRows[0];
            if (row.saleId) sale = await Sale.findById(row.saleId);
            if (!sale && row.invoiceNumber) sale = await Sale.findOne({ invoiceNumber: row.invoiceNumber });
            if (sale) break;
          }
        } catch (_) {}
      }
    }

    if (!sale) {
      // Check Order collection directly
      try {
        const order = await Order.findById(targetId);
        if (order) {
          const ordUpdate = {};
          if (customerName !== undefined) ordUpdate.customerName = customerName;
          if (customerPhone !== undefined) ordUpdate.customerPhone = customerPhone;
          if (customerEmail !== undefined) ordUpdate.customerEmail = customerEmail;
          if (totalAmount !== undefined) ordUpdate.totalAmount = Number(totalAmount);
          if (paymentMethod !== undefined) ordUpdate.paymentMethod = paymentMethod;
          if (items !== undefined) ordUpdate.items = items;
          const updatedOrder = await Order.findByIdAndUpdate(order.id, ordUpdate, { new: true });
          return res.json({ success: true, message: 'Order sale updated successfully', ...updatedOrder, sale: updatedOrder });
        }
      } catch (ordErr) { }
      return res.status(404).json({ message: 'Sale not found' });
    }

    const oldCashPaid = Number(sale.cashPaid) || 0;

    // Adjust stock differences if items are edited
    const oldSaleItems = Array.isArray(sale.items) ? sale.items : (typeof sale.items === 'string' ? JSON.parse(sale.items || '[]') : []);
    if (Array.isArray(items) && Array.isArray(oldSaleItems)) {
      for (const newItem of items) {
        const oldItem = oldSaleItems.find(i => String(i.productId || i.id || i._id) === String(newItem.productId || newItem.id || newItem._id));
        if (oldItem) {
          const qtyDifference = (Number(newItem.quantity) || 1) - (Number(oldItem.quantity) || 1);
          if (qtyDifference !== 0) {
            const product = await Item.findById(newItem.productId || newItem.id || newItem._id);
            if (product) {
              const stockDiff = Number(newItem.totalEggs) > 0 ? (Number(newItem.totalEggs) - (Number(oldItem.totalEggs) || 0)) : qtyDifference;
              const newStock = Math.max(0, (Number(product.stock) || 0) - stockDiff);
              await Item.findByIdAndUpdate(product.id, { stock: newStock, lastUpdated: new Date().toISOString().split('T')[0] });
            }
          }
        }
      }
    }

    const updateData = {};
    if (items !== undefined) updateData.items = items;
    if (totalAmount !== undefined) updateData.totalAmount = Number(totalAmount);
    if (totalProfit !== undefined) updateData.totalProfit = Number(totalProfit);
    if (customerName !== undefined) updateData.customerName = customerName;
    if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
    if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
    if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
    if (cashPaid !== undefined) updateData.cashPaid = Number(cashPaid);
    if (bankPaid !== undefined) updateData.bankPaid = Number(bankPaid);
    if (dueAmount !== undefined) {
      updateData.dueAmount = Number(dueAmount);
      updateData.isCredit = Number(dueAmount) > 0;
    }
    if (saleDate !== undefined) updateData.saleDate = new Date(saleDate);
    if (invoiceNumber !== undefined) updateData.invoiceNumber = invoiceNumber;

    const updatedSale = await Sale.findByIdAndUpdate(sale.id, updateData, { new: true });

    // Sync Customer table if customerId exists or matches email/phone
    if (sale.customerId || customerEmail || customerPhone) {
      try {
        const custUpdate = {};
        if (customerName) custUpdate.fullName = customerName;
        if (customerPhone) custUpdate.phone = customerPhone;
        if (customerEmail && customerEmail !== 'physical store pos') custUpdate.email = customerEmail;
        if (Object.keys(custUpdate).length > 0) {
          if (sale.customerId) {
            await Customer.findByIdAndUpdate(sale.customerId, custUpdate);
          }
          if (customerEmail && customerEmail !== 'physical store pos') {
            await Customer.updateMany({ email: customerEmail.toLowerCase() }, { $set: custUpdate });
          }
          if (customerPhone && customerPhone.length >= 7) {
            await Customer.updateMany({ phone: customerPhone }, { $set: custUpdate });
          }
        }
      } catch (custErr) {
        console.warn('Customer table sync warning:', custErr.message);
      }
    }

    // Sync with CustomerPaymentLedger branch table
    try {
      const cplId = String(targetId).startsWith('cpl-') ? targetId : `cpl-${sale.id}`;
      const cplUp = {};
      if (customerName !== undefined) cplUp.customerName = customerName;
      if (customerPhone !== undefined) cplUp.customerPhone = customerPhone;
      if (totalAmount !== undefined) cplUp.totalAmount = Number(totalAmount);
      if (cashPaid !== undefined) cplUp.cashPaid = Number(cashPaid);
      if (bankPaid !== undefined) cplUp.bankPaid = Number(bankPaid);
      if (dueAmount !== undefined) cplUp.dueAmount = Number(dueAmount);
      if (paymentMethod !== undefined) cplUp.paymentMethod = paymentMethod;
      if (req.body.category !== undefined) cplUp.category = req.body.category;
      const calcDue = cplUp.dueAmount !== undefined ? cplUp.dueAmount : Number(sale.dueAmount || 0);
      cplUp.status = calcDue === 0 ? 'PAID' : 'PARTIAL';

      if (Array.isArray(items) && items.length > 0) {
        let petis = 0;
        let eggs = 0;
        const descParts = [];
        items.forEach(it => {
          const qty = Number(it.quantity) || 1;
          const u = (it.unitLabel || it.unit || '').toLowerCase();
          const n = (it.rawProductName || it.name || '').toLowerCase();
          if (u.includes('peti') || n.includes('peti')) {
            petis += qty;
            eggs += qty * 360;
          } else if (u.includes('tray') || n.includes('tray')) {
            eggs += qty * 30;
          } else {
            eggs += Number(it.totalEggs) > 0 ? Number(it.totalEggs) : qty;
          }
          descParts.push(`${it.rawProductName || it.name || 'Eggs'} (x${qty})`);
        });
        cplUp.petisBought = petis;
        cplUp.eggsBought = eggs;
        cplUp.itemsDescription = descParts.join(', ');
      }

      await CustomerPaymentLedger.findByIdAndUpdate(cplId, cplUp);
      await CustomerPaymentLedger.findOneAndUpdate({ saleId: String(sale.id) }, cplUp);

      // Direct SQL update to ensure every branch customer payment ledger table stays synced
      const syncMatchIds = [String(targetId), String(sale.id), String(sale.invoiceNumber || '')].filter(Boolean);
      for (const pfx of (await getAllBranchPrefixesList())) {
        try {
          const syncSets = [];
          const syncVals = [];
          if (cplUp.customerName !== undefined) { syncSets.push('`customerName` = ?'); syncVals.push(cplUp.customerName); }
          if (cplUp.customerPhone !== undefined) { syncSets.push('`customerPhone` = ?'); syncVals.push(cplUp.customerPhone); }
          if (cplUp.totalAmount !== undefined) { syncSets.push('`totalAmount` = ?'); syncVals.push(cplUp.totalAmount); }
          if (cplUp.cashPaid !== undefined) { syncSets.push('`cashPaid` = ?'); syncVals.push(cplUp.cashPaid); }
          if (cplUp.bankPaid !== undefined) { syncSets.push('`bankPaid` = ?'); syncVals.push(cplUp.bankPaid); }
          if (cplUp.dueAmount !== undefined) { syncSets.push('`dueAmount` = ?'); syncVals.push(cplUp.dueAmount); }
          if (cplUp.status !== undefined) { syncSets.push('`status` = ?'); syncVals.push(cplUp.status); }
          if (cplUp.paymentMethod !== undefined) { syncSets.push('`paymentMethod` = ?'); syncVals.push(cplUp.paymentMethod); }
          if (req.body.category !== undefined) {
            const cat = req.body.category.toLowerCase() !== 'eggs' ? req.body.category : 'Premium';
            syncSets.push('`category` = ?'); syncVals.push(cat);
          }
          if (syncSets.length > 0 && syncMatchIds.length > 0) {
            const placeholders = syncMatchIds.map(() => '?').join(', ');
            await pool.query(
              `UPDATE \`${pfx}__customer_payment_ledger\` SET ${syncSets.join(', ')} WHERE \`id\` IN (${placeholders}) OR \`saleId\` IN (${placeholders}) OR \`invoiceNumber\` IN (${placeholders})`,
              [...syncVals, ...syncMatchIds, ...syncMatchIds, ...syncMatchIds]
            );
          }
        } catch (_) {}
      }
    } catch (cplErr) {
      console.warn('CustomerPaymentLedger sync warning:', cplErr.message);
    }

    // Sync linked Order if exists
    if (sale.orderId) {
      try {
        await Order.findByIdAndUpdate(sale.orderId, {
          customerName: updateData.customerName || sale.customerName,
          customerPhone: updateData.customerPhone || sale.customerPhone,
          customerEmail: updateData.customerEmail || sale.customerEmail,
          totalAmount: updateData.totalAmount !== undefined ? updateData.totalAmount : sale.totalAmount,
          paymentMethod: updateData.paymentMethod || sale.paymentMethod
        });
      } catch (e) { }
    }

    // Update active CashSession if cash amount changed
    if (cashPaid !== undefined && cashPaid !== oldCashPaid) {
      try {
        const activeSession = await CashSession.findOne({ status: 'open' });
        if (activeSession) {
          const diff = Number(cashPaid) - oldCashPaid;
          await CashSession.findByIdAndUpdate(activeSession.id, {
            totalSales: Math.max(0, (Number(activeSession.totalSales) || 0) + diff),
            expectedCash: Math.max(0, (Number(activeSession.expectedCash) || 0) + diff)
          });
        }
      } catch (e) { }
    }

    res.json({ success: true, message: 'Sale updated successfully', ...updatedSale, sale: updatedSale });
  } catch (err) {
    console.error('Edit sale error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Delete a sale permanently from database (both Sale and Order if exists)
router.delete('/:id', authenticate, requireShopAdmin, async (req, res) => {
  const canDelete = await checkBranchApproval(req, 'delete');
  if (!canDelete) {
    return res.status(403).json({ message: "🔒 Super Admin Approval Required: Delete actions are locked for this branch." });
  }
  try {
    const targetId = req.params.id;
    if (!targetId) {
      return res.status(400).json({ message: 'Target ID is required' });
    }

    let sale = await Sale.findById(targetId);
    if (!sale && String(targetId).startsWith('cpl-')) {
      const rawId = String(targetId).replace('cpl-', '');
      sale = await Sale.findById(rawId);
    }
    if (!sale) {
      sale = await Sale.findOne({ invoiceNumber: targetId });
    }
    if (!sale) {
      sale = await Sale.findOne({ orderId: targetId });
    }
    if (!sale && (req.query?.invoiceNumber || req.body?.invoiceNumber)) {
      const inv = req.query?.invoiceNumber || req.body?.invoiceNumber;
      sale = await Sale.findOne({ invoiceNumber: inv });
    }
    if (!sale && (req.query?.saleId || req.body?.saleId)) {
      const sid = req.query?.saleId || req.body?.saleId;
      sale = await Sale.findById(sid);
    }
    if (!sale) {
      // Look up targetId in branch customer payment ledger tables to find saleId or invoiceNumber
      for (const pfx of (await getAllBranchPrefixesList())) {
        try {
          const [ledgerRows] = await pool.query(
            `SELECT saleId, invoiceNumber FROM \`${pfx}__customer_payment_ledger\` WHERE \`id\` = ? OR \`saleId\` = ? OR \`invoiceNumber\` = ? LIMIT 1`,
            [targetId, targetId, targetId]
          );
          if (ledgerRows && ledgerRows.length > 0) {
            const row = ledgerRows[0];
            if (row.saleId) sale = await Sale.findById(row.saleId);
            if (!sale && row.invoiceNumber) sale = await Sale.findOne({ invoiceNumber: row.invoiceNumber });
            if (sale) break;
          }
        } catch (_) {}
      }
    }

    if (sale) {
      const amountToDeduct = Number(sale.cashPaid || sale.totalAmount) || 0;

      // 1. Reverse inventory stock
      for (const item of (sale.items || [])) {
        const pId = item.productId || item.id || item._id;
        if (pId) {
          try {
            const product = await Item.findById(pId);
            if (product) {
              const qty = Number(item.quantity) || 1;
              const stockToAdd = Number(item.totalEggs) > 0 ? Number(item.totalEggs) : qty;
              const newStock = (Number(product.stock) || 0) + stockToAdd;
              const updateObj = { stock: newStock, lastUpdated: new Date().toISOString().split('T')[0] };
              if (product.unitType === 'peti') {
                updateObj.petiQuantity = (Number(product.petiQuantity) || 0) + qty;
              } else if (product.unitType === 'tray') {
                updateObj.trayQuantity = (Number(product.trayQuantity) || 0) + qty;
              } else if (product.unitType === 'egg') {
                updateObj.eggQuantity = newStock;
              }
              await Item.findByIdAndUpdate(product.id, updateObj);
            }
          } catch (e) { }
        }
      }

      // 2. Delete from MySQL sales and sale_items
      await Sale.findByIdAndDelete(sale.id);
      await removeSaleFromBranchHistories(sale.id, sale.shopId);

      // 3. Delete associated Invoice PDF if it exists
      const fileName = `invoice-${sale.id || sale._id}.pdf`;
      const filePath = path.join(__dirname, '..', 'invoices', fileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (fileErr) { }
      }

      // 4. Update active CashSession
      if (amountToDeduct > 0) {
        try {
          const activeSession = await CashSession.findOne({ status: 'open' });
          if (activeSession) {
            await CashSession.findByIdAndUpdate(activeSession.id, {
              totalSales: Math.max(0, (Number(activeSession.totalSales) || 0) - amountToDeduct),
              expectedCash: Math.max(0, (Number(activeSession.expectedCash) || 0) - amountToDeduct)
            });
          }
        } catch (e) { }
      }

      // 5. Delete linked order if any
      if (sale.orderId) {
        try {
          await Order.findByIdAndDelete(sale.orderId);
        } catch (e) { }
      }
    }

    // Direct SQL deletion across all CustomerPaymentLedger branch tables
    const deleteMatchIds = [String(targetId)];
    if (sale?.id) deleteMatchIds.push(String(sale.id));
    if (sale?.invoiceNumber) deleteMatchIds.push(String(sale.invoiceNumber));
    if (req.query?.invoiceNumber) deleteMatchIds.push(String(req.query.invoiceNumber));
    if (req.query?.saleId) deleteMatchIds.push(String(req.query.saleId));

    for (const pfx of (await getAllBranchPrefixesList())) {
      try {
        const placeholders = deleteMatchIds.map(() => '?').join(', ');
        await pool.query(
          `DELETE FROM \`${pfx}__customer_payment_ledger\` WHERE \`id\` IN (${placeholders}) OR \`saleId\` IN (${placeholders}) OR \`invoiceNumber\` IN (${placeholders})`,
          [...deleteMatchIds, ...deleteMatchIds, ...deleteMatchIds]
        );
      } catch (cplDelErr) {
        console.warn(`CustomerPaymentLedger delete warning for ${pfx}:`, cplDelErr.message);
      }
    }

    // Also check Order collection directly
    try {
      await Order.findByIdAndDelete(targetId);
    } catch (ordErr) { }

    res.json({ success: true, message: 'Sale and associated records permanently deleted from database' });
  } catch (err) {
    console.error('Delete sale error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Dedicated Customer & Vendor Payment Ledger update/delete routes
router.put('/customer-payment-ledger/:id', authenticate, requireShopAdmin, async (req, res) => {
  const canEdit = await checkBranchApproval(req, 'edit', 'customerPaymentLedger');
  if (!canEdit) {
    return res.status(403).json({ message: "🔒 Super Admin Approval Required: Customer info edit is locked for this branch." });
  }
  try {
    const { id } = req.params;
    const body = req.body || {};

    // 1. Direct SQL update to all branch customer payment ledger tables
    const matchIds = [String(id), String(body.saleId || ''), String(body.invoiceNumber || '')].filter(Boolean);
    for (const pfx of (await getAllBranchPrefixesList())) {
      try {
        const sets = [];
        const vals = [];
        if (body.customerName !== undefined) { sets.push('`customerName` = ?'); vals.push(body.customerName); }
        if (body.customerPhone !== undefined) { sets.push('`customerPhone` = ?'); vals.push(body.customerPhone); }
        if (body.totalAmount !== undefined) { sets.push('`totalAmount` = ?'); vals.push(Number(body.totalAmount)); }
        if (body.cashPaid !== undefined) { sets.push('`cashPaid` = ?'); vals.push(Number(body.cashPaid)); }
        if (body.bankPaid !== undefined) { sets.push('`bankPaid` = ?'); vals.push(Number(body.bankPaid)); }
        if (body.dueAmount !== undefined) { sets.push('`dueAmount` = ?'); vals.push(Number(body.dueAmount)); }
        if (body.paymentMethod !== undefined) { sets.push('`paymentMethod` = ?'); vals.push(body.paymentMethod); }
        if (body.status !== undefined) { sets.push('`status` = ?'); vals.push(body.status); }
        if (body.category !== undefined) {
          const cat = body.category.toLowerCase() !== 'eggs' ? body.category : 'Premium';
          sets.push('`category` = ?'); vals.push(cat);
        }
        if (sets.length > 0 && matchIds.length > 0) {
          const placeholders = matchIds.map(() => '?').join(', ');
          await pool.query(
            `UPDATE \`${pfx}__customer_payment_ledger\` SET ${sets.join(', ')} WHERE \`id\` IN (${placeholders}) OR \`saleId\` IN (${placeholders}) OR \`invoiceNumber\` IN (${placeholders})`,
            [...vals, ...matchIds, ...matchIds, ...matchIds]
          );
        }
      } catch (_) {}
    }

    // 2. Also update Sale table if matching sale exists
    let sale = await Sale.findById(id);
    if (!sale && body.saleId) sale = await Sale.findById(body.saleId);
    if (!sale && body.invoiceNumber) sale = await Sale.findOne({ invoiceNumber: body.invoiceNumber });
    if (sale) {
      const saleUpdate = {};
      if (body.customerName !== undefined) saleUpdate.customerName = body.customerName;
      if (body.customerPhone !== undefined) saleUpdate.customerPhone = body.customerPhone;
      if (body.totalAmount !== undefined) saleUpdate.totalAmount = Number(body.totalAmount);
      if (body.cashPaid !== undefined) saleUpdate.cashPaid = Number(body.cashPaid);
      if (body.bankPaid !== undefined) saleUpdate.bankPaid = Number(body.bankPaid);
      if (body.dueAmount !== undefined) {
        saleUpdate.dueAmount = Number(body.dueAmount);
        saleUpdate.isCredit = Number(body.dueAmount) > 0;
      }
      if (body.paymentMethod !== undefined) saleUpdate.paymentMethod = body.paymentMethod;
      await Sale.findByIdAndUpdate(sale.id, saleUpdate);
    }

    res.json({ success: true, message: 'Customer ledger and sale updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/customer-payment-ledger/:id', authenticate, requireShopAdmin, async (req, res) => {
  const canDelete = await checkBranchApproval(req, 'delete', 'customerPaymentLedger');
  if (!canDelete) {
    return res.status(403).json({ message: "🔒 Super Admin Approval Required: Customer ledger delete is locked for this branch." });
  }
  try {
    const { id } = req.params;
    const invNo = req.query?.invoiceNumber || req.body?.invoiceNumber;
    const sId = req.query?.saleId || req.body?.saleId;

    let sale = await Sale.findById(id);
    if (!sale && sId) sale = await Sale.findById(sId);
    if (!sale && invNo) sale = await Sale.findOne({ invoiceNumber: invNo });
    if (!sale) {
      for (const pfx of (await getAllBranchPrefixesList())) {
        try {
          const [ledgerRows] = await pool.query(
            `SELECT saleId, invoiceNumber FROM \`${pfx}__customer_payment_ledger\` WHERE \`id\` = ? OR \`saleId\` = ? OR \`invoiceNumber\` = ? LIMIT 1`,
            [id, id, id]
          );
          if (ledgerRows && ledgerRows.length > 0) {
            const row = ledgerRows[0];
            if (row.saleId) sale = await Sale.findById(row.saleId);
            if (!sale && row.invoiceNumber) sale = await Sale.findOne({ invoiceNumber: row.invoiceNumber });
            if (sale) break;
          }
        } catch (_) {}
      }
    }

    if (sale) {
      await Sale.findByIdAndDelete(sale.id);
      await removeSaleFromBranchHistories(sale.id, sale.shopId);
    }

    const deleteMatchIds = [String(id)];
    if (sale?.id) deleteMatchIds.push(String(sale.id));
    if (sale?.invoiceNumber) deleteMatchIds.push(String(sale.invoiceNumber));
    if (invNo) deleteMatchIds.push(String(invNo));
    if (sId) deleteMatchIds.push(String(sId));

    for (const pfx of (await getAllBranchPrefixesList())) {
      try {
        const placeholders = deleteMatchIds.map(() => '?').join(', ');
        await pool.query(
          `DELETE FROM \`${pfx}__customer_payment_ledger\` WHERE \`id\` IN (${placeholders}) OR \`saleId\` IN (${placeholders}) OR \`invoiceNumber\` IN (${placeholders})`,
          [...deleteMatchIds, ...deleteMatchIds, ...deleteMatchIds]
        );
      } catch (_) {}
    }

    res.json({ success: true, message: 'Deleted from customer payment ledger and sales' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/vendor-payment-ledger/:id', authenticate, requireShopAdmin, async (req, res) => {
  const canEdit = await checkBranchApproval(req, 'edit', 'vendors');
  if (!canEdit) {
    return res.status(403).json({ message: "🔒 Super Admin Approval Required: Vendor bill edit is locked for this branch." });
  }
  try {
    const { id } = req.params;
    const cleanId = String(id).replace('vpl-', '').replace('item-', '');
    for (const pfx of (await getAllBranchPrefixesList())) {
      try {
        const sets = [];
        const vals = [];
        for (const [k, v] of Object.entries(req.body)) {
          if (k === 'id' || k === '_id') continue;
          sets.push(`\`${k}\` = ?`);
          vals.push(v);
        }
        if (sets.length > 0) {
          vals.push(id, cleanId);
          await pool.query(`UPDATE \`${pfx}__vendor_payment_ledger\` SET ${sets.join(', ')} WHERE \`id\` = ? OR \`purchaseId\` = ?`, vals);
        }
      } catch (_) {}
    }
    res.json({ success: true, message: 'Updated vendor payment ledger' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/vendor-payment-ledger/:id', authenticate, requireShopAdmin, async (req, res) => {
  const canDelete = await checkBranchApproval(req, 'delete', 'vendors');
  if (!canDelete) {
    return res.status(403).json({ message: "🔒 Super Admin Approval Required: Vendor bill delete is locked for this branch." });
  }
  try {
    const { id } = req.params;
    const cleanId = String(id).replace('vpl-', '').replace('item-', '');
    for (const pfx of (await getAllBranchPrefixesList())) {
      try {
        await pool.query(
          `DELETE FROM \`${pfx}__vendor_payment_ledger\` WHERE \`id\` = ? OR \`purchaseId\` = ?`,
          [id, cleanId]
        );
      } catch (_) {}
      try {
        await pool.query(
          `DELETE FROM \`${pfx}__purchase_credits\` WHERE \`id\` = ? OR \`purchaseId\` = ?`,
          [cleanId, cleanId]
        );
      } catch (_) {}
    }
    res.json({ success: true, message: 'Deleted from vendor payment ledger' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Approve or Reject Bank Transfer Sale
router.patch('/:id/approve', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const { approvalStatus = 'APPROVED' } = req.body;
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sale not found' });
    sale.approvalStatus = approvalStatus;
    await sale.save();
    res.json({ success: true, message: `Sale ${approvalStatus.toLowerCase()} successfully`, sale });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper logic for executing credit settlement
const processCreditSettlement = async (saleId, bodyData = {}, res) => {
  try {
    const {
      paymentMethod = 'CASH',
      amountPaid,
      transactionId,
      paymentProof,
      paymentReceipt,
      creditId: bodyCreditId,
      saleId: bodySaleId,
      invoiceNumber: bodyInvoiceNumber,
      customerName: bodyCustomerName,
      customerPhone: bodyCustomerPhone,
      shopId: bodyShopId
    } = bodyData;

    const rawShopId = bodyShopId || bodyData?.shopId || 1;
    const realShopId = (await resolveShopId(rawShopId)) || Number(rawShopId) || 1;
    const pfx = (realShopId && BRANCH_TABLE_PREFIXES[realShopId]) || 'peshawar_branch';
    const mysqlModule = await import('../config/mysql.js');
    const pool = mysqlModule.default;
    const { ALL_BRANCH_PREFIXES } = await import('../models/dbHelper.js');

    // 1. Try to find the credit record in MySQL
    let creditRecord = null;
    const creditSearchTerms = [bodyCreditId, saleId, bodySaleId].filter(Boolean);
    for (const term of creditSearchTerms) {
      try {
        const [cRows] = await pool.query(
          `SELECT * FROM \`${pfx}__customer_credits\` WHERE \`id\` = ? OR \`saleId\` = ? OR \`notes\` = ? LIMIT 1`,
          [term, term, term]
        );
        if (cRows && cRows.length > 0) {
          creditRecord = cRows[0];
          break;
        }
      } catch (_) {}
    }

    if (!creditRecord && bodyInvoiceNumber) {
      try {
        const [cRows] = await pool.query(
          `SELECT * FROM \`${pfx}__customer_credits\` WHERE \`notes\` = ? OR \`notes\` LIKE ? LIMIT 1`,
          [bodyInvoiceNumber, `%${bodyInvoiceNumber}%`]
        );
        if (cRows && cRows.length > 0) creditRecord = cRows[0];
      } catch (_) {}
    }

    // Cross-branch credit lookup if not in target branch
    if (!creditRecord) {
      for (const bpfx of ALL_BRANCH_PREFIXES) {
        if (bpfx === pfx) continue;
        try {
          const [cRows] = await pool.query(
            `SELECT * FROM \`${bpfx}__customer_credits\` WHERE \`id\` = ? OR \`saleId\` = ? OR \`notes\` = ? LIMIT 1`,
            [saleId, saleId, saleId]
          );
          if (cRows && cRows.length > 0) {
            creditRecord = cRows[0];
            break;
          }
        } catch (_) {}
      }
    }

    // 2. Try to find the sale record in MySQL
    let saleRecord = null;
    const saleSearchTerms = [creditRecord?.saleId, bodySaleId, saleId].filter(Boolean);
    for (const term of saleSearchTerms) {
      try {
        const [sRows] = await pool.query(
          `SELECT * FROM \`${pfx}__sales\` WHERE \`id\` = ? OR \`invoiceNumber\` = ? LIMIT 1`,
          [term, term]
        );
        if (sRows && sRows.length > 0) {
          saleRecord = sRows[0];
          break;
        }
      } catch (_) {}
    }

    if (!saleRecord && (bodyInvoiceNumber || creditRecord?.notes)) {
      const inv = bodyInvoiceNumber || creditRecord?.notes;
      try {
        const [sRows] = await pool.query(
          `SELECT * FROM \`${pfx}__sales\` WHERE \`invoiceNumber\` = ? LIMIT 1`,
          [inv]
        );
        if (sRows && sRows.length > 0) saleRecord = sRows[0];
      } catch (_) {}
    }

    // 3. Fallback / lookup in MongoDB / BaseModel
    let sale = null;
    if (saleRecord?.id) {
      sale = await Sale.findById(saleRecord.id).catch(() => null);
    }
    if (!sale && saleId) {
      sale = await Sale.findById(saleId).catch(() => null);
    }
    if (!sale && bodySaleId) {
      sale = await Sale.findById(bodySaleId).catch(() => null);
    }
    if (!sale && (bodyInvoiceNumber || creditRecord?.notes)) {
      const inv = bodyInvoiceNumber || creditRecord?.notes;
      sale = await Sale.findOne({ invoiceNumber: inv }).catch(() => null);
    }

    if (!sale && !saleRecord && !creditRecord) {
      return res.status(404).json({ success: false, message: 'Sale or credit record not found' });
    }

    // 4. Determine current due and settlement amount
    const currentDue = Number(
      (creditRecord && creditRecord.dueAmount !== undefined) ? creditRecord.dueAmount :
      (saleRecord && saleRecord.dueAmount !== undefined) ? saleRecord.dueAmount :
      (sale && sale.dueAmount !== undefined) ? sale.dueAmount :
      (saleRecord?.totalAmount || creditRecord?.totalAmount || 0)
    );

    const settleAmount = amountPaid ? Math.min(Number(amountPaid), currentDue > 0 ? currentDue : Number(amountPaid)) : (currentDue > 0 ? currentDue : Number(amountPaid || 0));

    if (settleAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    const method = String(paymentMethod).toUpperCase();
    const isBank = method === 'BANK_TRANSFER' || method === 'BANK' || method === 'ONLINE' || method === 'EASYPAISA';
    const newDue = Math.max(0, currentDue - settleAmount);
    const creditStatus = newDue <= 0 ? 'PAID' : 'PARTIAL';
    const saleStatus = newDue <= 0 ? 'completed' : 'pending';

    const invBase = saleRecord?.invoiceNumber || creditRecord?.notes || bodyInvoiceNumber || (saleRecord?.id ? `INV-${String(saleRecord.id).padStart(5, '0')}` : (sale?.invoiceNumber || `INV-${Date.now()}`));
    const customerName = creditRecord?.customerName || saleRecord?.customerName || sale?.customerName || bodyCustomerName || 'Credit Customer';
    const customerPhone = creditRecord?.customerPhone || saleRecord?.customerPhone || sale?.customerPhone || bodyCustomerPhone || '';
    const customerEmail = creditRecord?.customerEmail || saleRecord?.customerEmail || sale?.customerEmail || '';
    const customerId = creditRecord?.customerId || saleRecord?.customerId || sale?.customerId || null;

    // 5. Update customer_credits table in all branch tables
    const creditIdToUpdate = creditRecord?.id || bodyCreditId;
    const saleIdToUpdate = saleRecord?.id || creditRecord?.saleId || bodySaleId || saleId;
    const noteToUpdate = invBase;

    for (const prefix of ALL_BRANCH_PREFIXES) {
      try {
        await pool.query(
          `UPDATE \`${prefix}__customer_credits\`
           SET \`paidAmount\` = \`paidAmount\` + ?,
               \`dueAmount\` = ?,
               \`status\` = ?,
               \`lastPaymentDate\` = NOW(),
               \`updatedAt\` = NOW()
           WHERE \`id\` = ? OR \`saleId\` = ? OR \`notes\` = ?`,
          [settleAmount, newDue, creditStatus, creditIdToUpdate, saleIdToUpdate, noteToUpdate]
        );
      } catch (e) {
        console.warn(`Error updating ${prefix}__customer_credits:`, e.message);
      }
    }

    // Also update CustomerCredit model (BaseModel / MongoDB)
    try {
      if (creditIdToUpdate) {
        await CustomerCredit.findByIdAndUpdate(creditIdToUpdate, {
          $inc: { paidAmount: settleAmount },
          dueAmount: newDue,
          status: creditStatus,
          lastPaymentDate: new Date()
        });
      }
      if (saleIdToUpdate) {
        await CustomerCredit.findOneAndUpdate({ saleId: saleIdToUpdate }, {
          $inc: { paidAmount: settleAmount },
          dueAmount: newDue,
          status: creditStatus,
          lastPaymentDate: new Date()
        });
      }
    } catch (_) {}

    // 6. Update the original sale record in MySQL & MongoDB (if present)
    if (saleRecord?.id) {
      try {
        await pool.query(
          `UPDATE \`${pfx}__sales\`
           SET \`dueAmount\` = ?,
               \`isCredit\` = ?,
               \`status\` = ?,
               \`updatedAt\` = NOW()
           WHERE \`id\` = ?`,
          [newDue, newDue > 0 ? 1 : 0, saleStatus, saleRecord.id]
        );
      } catch (e) {
        console.warn(`Error updating original sale in ${pfx}__sales:`, e.message);
      }
    }

    if (sale?.id || sale?._id) {
      try {
        await Sale.findByIdAndUpdate(sale.id || sale._id, {
          dueAmount: newDue,
          isCredit: newDue > 0,
          status: saleStatus,
          lastPaymentDate: new Date()
        });
      } catch (_) {}
    }

    // 7. INSERT PAYMENT TRANSACTION RECORD FOR TODAY IN ${pfx}__sales
    const cashAmt = isBank ? 0 : settleAmount;
    const bankAmt = isBank ? settleAmount : 0;
    const recInvNumber = `${invBase}-REC-${Date.now() % 10000}`;
    const serialNumber = Math.floor(Date.now() % 10000000000); // numeric bigint(20)

    let createdPaymentSaleId = null;
    try {
      const itemsJson = JSON.stringify([{
        name: `Credit Settlement (${invBase})`,
        quantity: 1,
        price: settleAmount,
        total: settleAmount,
        category: 'Credit Payment'
      }]);

      const [insertRes] = await pool.query(
        `INSERT INTO \`${pfx}__sales\`
           (\`shopId\`, \`totalAmount\`, \`totalProfit\`, \`serialNumber\`, \`invoiceNumber\`, \`saleDate\`,
            \`status\`, \`paymentMethod\`, \`cashPaid\`, \`bankPaid\`, \`dueAmount\`, \`isCredit\`,
            \`customerName\`, \`customerPhone\`, \`customerEmail\`, \`customerId\`,
            \`category\`, \`itemsDescription\`, \`items\`, \`petisBought\`, \`eggsBought\`,
            \`transactionId\`, \`paymentProof\`, \`paymentReceipt\`, \`createdAt\`, \`updatedAt\`)
         VALUES (?, ?, 0, ?, ?, NOW(), 'completed', ?, ?, ?, 0, 0, ?, ?, ?, ?, 'Credit Payment', ?, ?, 0, 0, ?, ?, ?, NOW(), NOW())`,
        [
          realShopId, settleAmount, serialNumber, recInvNumber,
          isBank ? 'BANK_TRANSFER' : 'CASH', cashAmt, bankAmt,
          customerName, customerPhone, customerEmail, customerId,
          `Credit Settlement for ${invBase} (${customerName})`,
          itemsJson,
          transactionId || '', paymentProof || paymentReceipt || '', paymentProof || paymentReceipt || ''
        ]
      );
      createdPaymentSaleId = insertRes.insertId;
    } catch (salesInsertErr) {
      console.warn(`[processCreditSettlement] error inserting payment sale into ${pfx}__sales:`, salesInsertErr.message);
    }

    // Also create in Sale model for MongoDB / BaseModel fallback
    let createdPaymentSale = null;
    try {
      createdPaymentSale = await Sale.create({
        shopId: realShopId,
        invoiceNumber: recInvNumber,
        serialNumber: serialNumber,
        customerName,
        customerPhone,
        customerEmail,
        customerId,
        saleDate: new Date(),
        createdAt: new Date(),
        totalAmount: settleAmount,
        totalProfit: 0,
        cashPaid: cashAmt,
        bankPaid: bankAmt,
        dueAmount: 0,
        isCredit: 0,
        status: 'completed',
        paymentMethod: isBank ? 'BANK_TRANSFER' : 'CASH',
        category: 'Credit Payment',
        itemsDescription: `Credit Settlement for ${invBase} (${customerName})`,
        items: [{
          name: `Credit Settlement (${invBase})`,
          quantity: 1,
          price: settleAmount,
          total: settleAmount,
          category: 'Credit Payment'
        }],
        transactionId: transactionId || '',
        paymentProof: paymentProof || paymentReceipt || null
      });
    } catch (_) {}

    // 8. INSERT INTO ${pfx}__today_sales_history FOR TODAY
    const tshTable = `${pfx}__today_sales_history`;
    try {
      const tshId = `tsh-rec-${createdPaymentSaleId || Date.now()}`;
      await pool.query(
        `INSERT INTO \`${tshTable}\`
           (\`id\`, \`shopId\`, \`reportDate\`, \`invoiceNumber\`, \`saleId\`, \`customerName\`, \`customerPhone\`,
            \`category\`, \`itemsSummary\`, \`grossSale\`, \`cashPaid\`, \`bankPaid\`, \`dueAmount\`, \`paymentMethod\`,
            \`shopExpense\`, \`fuelExpense\`, \`damagedLoss\`, \`netResult\`, \`cashInDrawer\`, \`notes\`, \`createdAt\`, \`updatedAt\`)
         VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'Credit Payment', ?, ?, ?, ?, 0, ?, 0, 0, 0, ?, ?, ?, NOW(), NOW())`,
        [
          tshId, realShopId, recInvNumber, String(createdPaymentSaleId || serialNumber), customerName, customerPhone,
          `Credit Payment (${invBase})`, settleAmount, cashAmt, bankAmt,
          isBank ? 'BANK_TRANSFER' : 'CASH', settleAmount, cashAmt, `Credit recovery for ${invBase}`
        ]
      );
    } catch (tshErr) {
      console.warn(`[processCreditSettlement] error inserting into ${tshTable}:`, tshErr.message);
    }

    // 9. INSERT INTO ${pfx}__customer_payment_ledger
    const cplTable = `${pfx}__customer_payment_ledger`;
    try {
      const cplId = `cpl-rec-${createdPaymentSaleId || Date.now()}`;
      await pool.query(
        `INSERT INTO \`${cplTable}\`
           (\`id\`, \`shopId\`, \`saleId\`, \`invoiceNumber\`, \`customerName\`, \`customerPhone\`,
            \`category\`, \`itemsDescription\`, \`petisBought\`, \`eggsBought\`, \`totalAmount\`,
            \`cashPaid\`, \`bankPaid\`, \`dueAmount\`, \`paymentMethod\`, \`status\`, \`date\`, \`createdAt\`, \`updatedAt\`)
         VALUES (?, ?, ?, ?, ?, ?, 'Credit Payment', ?, 0, 0, ?, ?, ?, 0, ?, 'PAID', NOW(), NOW(), NOW())`,
        [
          cplId, realShopId, String(createdPaymentSaleId || serialNumber), recInvNumber, customerName, customerPhone,
          `Credit settlement for ${invBase}`, settleAmount, cashAmt, bankAmt,
          isBank ? 'BANK_TRANSFER' : 'CASH'
        ]
      );
    } catch (cplErr) {
      console.warn(`[processCreditSettlement] error inserting into ${cplTable}:`, cplErr.message);
    }

    // 10. Update open CashSession if Cash payment
    if (!isBank) {
      try {
        const activeSession = await CashSession.findOne({ status: 'open' });
        if (activeSession) {
          activeSession.totalSales = (Number(activeSession.totalSales) || 0) + settleAmount;
          activeSession.expectedCash = (Number(activeSession.expectedCash) || 0) + settleAmount;
          await activeSession.save();
        }
      } catch (csErr) {
        console.warn('Error updating cash session:', csErr.message);
      }
    }

    // 11. Update Order if applicable
    try {
      const order = await Order.findById(saleId);
      if (order) {
        if (newDue === 0) {
          order.paymentStatus = 'PAID';
        }
        order.paymentMethod = isBank ? 'BANK_TRANSFER' : 'CASH';
        await Order.findByIdAndUpdate(order.id, order);
      }
    } catch (_) {}

    return res.json({
      success: true,
      message: `Credit payment of Rs. ${settleAmount.toLocaleString('en-PK')} recorded successfully for Today via ${isBank ? 'Bank Transfer' : 'Cash'}!`,
      newDue,
      settleAmount,
      paymentMethod: isBank ? 'BANK_TRANSFER' : 'CASH',
      sale: saleRecord || sale,
      paymentSale: createdPaymentSale
    });
  } catch (err) {
    console.error('Settle credit error:', err);
    return res.status(500).json({ message: err.message });
  }
};

// ── DEDICATED ROUTE 1: SETTLE CREDIT VIA CASH ──
router.patch('/:id/settle-cash', authenticate, requireShopAdmin, async (req, res) => {
  await processCreditSettlement(req.params.id, { ...req.body, paymentMethod: 'CASH' }, res);
});

// ── DEDICATED ROUTE 2: SETTLE CREDIT VIA BANK TRANSFER ──
router.patch('/:id/settle-bank', authenticate, requireShopAdmin, async (req, res) => {
  await processCreditSettlement(req.params.id, { ...req.body, paymentMethod: 'BANK_TRANSFER' }, res);
});

// ── 1-CLICK INSTANT PAYMENT CHANNEL TRANSFER (CASH <-> BANK) FOR SINGLE SALE ──
router.patch('/:id/transfer-channel', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { targetMethod, target, amount } = req.body;
    const dest = String(targetMethod || target || 'BANK').toUpperCase();
    const isToBank = dest === 'BANK' || dest === 'BANK_TRANSFER' || dest === 'ONLINE';

    let sale = await Sale.findById(id);
    if (!sale) sale = await Sale.findOne({ invoiceNumber: id });
    if (!sale) {
      const numId = Number(id);
      if (!isNaN(numId)) sale = await Sale.findOne({ id: numId });
    }
    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale record not found' });
    }

    const totalAmt = Number(sale.totalAmount) || 0;
    let oldCash = Number(sale.cashPaid !== undefined ? sale.cashPaid : (String(sale.paymentMethod || '').toUpperCase() === 'CASH' ? totalAmt : 0));
    let oldBank = Number(sale.bankPaid !== undefined ? sale.bankPaid : (String(sale.paymentMethod || '').toUpperCase().includes('BANK') ? totalAmt : 0));
    let due = Number(sale.dueAmount || 0);

    let newCash = oldCash;
    let newBank = oldBank;
    let movedAmount = 0;

    if (isToBank) {
      // Transfer from Cash -> Bank
      const availableToMove = oldCash > 0 ? oldCash : (oldBank === 0 && due === 0 ? totalAmt : 0);
      if (availableToMove <= 0) {
        return res.status(400).json({ success: false, message: 'No cash amount available to transfer to bank for this sale' });
      }
      movedAmount = amount ? Math.min(Number(amount), availableToMove) : availableToMove;
      newCash = Math.max(0, availableToMove - movedAmount);
      newBank = oldBank + movedAmount;
    } else {
      // Transfer from Bank -> Cash
      const availableToMove = oldBank > 0 ? oldBank : (oldCash === 0 && due === 0 ? totalAmt : 0);
      if (availableToMove <= 0) {
        return res.status(400).json({ success: false, message: 'No bank amount available to transfer to cash for this sale' });
      }
      movedAmount = amount ? Math.min(Number(amount), availableToMove) : availableToMove;
      newBank = Math.max(0, availableToMove - movedAmount);
      newCash = oldCash + movedAmount;
    }

    const newPaymentMethod = newCash > 0 && newBank > 0 ? 'SPLIT' : (newBank > 0 ? 'BANK' : 'CASH');

    sale.cashPaid = newCash;
    sale.bankPaid = newBank;
    sale.paymentMethod = newPaymentMethod;
    const updatedSale = await Sale.findByIdAndUpdate(sale.id || sale._id, {
      cashPaid: newCash,
      bankPaid: newBank,
      paymentMethod: newPaymentMethod
    }, { new: true });

    // Update in MySQL branch tables
    const targetShopId = Number(sale.shopId || 1);
    const pfx = (targetShopId && BRANCH_TABLE_PREFIXES[targetShopId]) || 'peshawar_branch';
    const mysqlModule = await import('../config/mysql.js');
    const pool = mysqlModule.default;

    try {
      await pool.query(
        `UPDATE \`${pfx}__sales\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`id\` = ? OR \`invoiceNumber\` = ?`,
        [newCash, newBank, newPaymentMethod, sale.id, sale.invoiceNumber]
      );
    } catch (e) {
      console.warn(`[transfer-channel] sales table update error:`, e.message);
    }

    try {
      await pool.query(
        `UPDATE \`${pfx}__customer_payment_ledger\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`saleId\` = ? OR \`invoiceNumber\` = ?`,
        [newCash, newBank, newPaymentMethod, String(sale.id), sale.invoiceNumber]
      );
    } catch (e) {
      console.warn(`[transfer-channel] customer_payment_ledger update error:`, e.message);
    }

    try {
      await pool.query(
        `UPDATE \`${pfx}__today_sales_history\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`saleId\` = ? OR \`invoiceNumber\` = ?`,
        [newCash, newBank, newPaymentMethod, String(sale.id), sale.invoiceNumber]
      );
    } catch (e) {
      console.warn(`[transfer-channel] today_sales_history update error:`, e.message);
    }

    // Sync CustomerPaymentLedger & TodaySalesHistory models
    try {
      await CustomerPaymentLedger.updateMany(
        { $or: [{ saleId: String(sale.id) }, { invoiceNumber: sale.invoiceNumber }] },
        { $set: { cashPaid: newCash, bankPaid: newBank, paymentMethod: newPaymentMethod } }
      );
    } catch (_) {}

    try {
      await TodaySalesHistory.updateMany(
        { $or: [{ saleId: String(sale.id) }, { invoiceNumber: sale.invoiceNumber }] },
        { $set: { cashPaid: newCash, bankPaid: newBank, paymentMethod: newPaymentMethod } }
      );
    } catch (_) {}

    // Adjust active CashSession
    const cashDiff = newCash - oldCash;
    if (cashDiff !== 0) {
      try {
        const activeSession = await CashSession.findOne({ status: 'open' });
        if (activeSession) {
          await CashSession.findByIdAndUpdate(activeSession.id, {
            totalSales: Math.max(0, (Number(activeSession.totalSales) || 0) + cashDiff),
            expectedCash: Math.max(0, (Number(activeSession.expectedCash) || 0) + cashDiff)
          });
        }
      } catch (_) {}
    }

    res.json({
      success: true,
      message: `Transferred Rs. ${movedAmount.toLocaleString('en-PK')} to ${isToBank ? 'Bank' : 'Cash'} successfully`,
      sale: updatedSale,
      movedAmount,
      targetMethod: newPaymentMethod
    });
  } catch (err) {
    console.error('Transfer sale channel error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 1-CLICK BULK TRANSFER TODAY DRAWER FUNDS (CASH DRAWER <-> BANK) ──
router.post('/transfer-drawer-funds', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const { shopId, targetMethod, target, amount } = req.body;
    const dest = String(targetMethod || target || 'BANK').toUpperCase();
    const isToBank = dest === 'BANK' || dest === 'BANK_TRANSFER' || dest === 'ONLINE';

    const rawShopId = shopId || req.user?.shopId;
    const realShopId = await resolveShopId(rawShopId) || Number(rawShopId) || 1;
    const pfx = BRANCH_TABLE_PREFIXES[realShopId] || 'peshawar_branch';

    const mysqlModule = await import('../config/mysql.js');
    const pool = mysqlModule.default;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Find today's sales for this branch
    let todaySales = await Sale.find({
      shopId: realShopId,
      $or: [
        { saleDate: { $gte: new Date(todayStr) } },
        { createdAt: { $gte: new Date(todayStr) } }
      ]
    });

    if (todaySales.length === 0) {
      // Fallback query from MySQL table
      try {
        const [rows] = await pool.query(
          `SELECT * FROM \`${pfx}__sales\` WHERE DATE(\`saleDate\`) = ? OR DATE(\`createdAt\`) = ?`,
          [todayStr, todayStr]
        );
        todaySales = rows || [];
      } catch (_) {}
    }

    let remainingToMove = amount ? Number(amount) : Infinity;
    let totalMoved = 0;

    for (const s of todaySales) {
      if (remainingToMove <= 0) break;
      const sTotal = Number(s.totalAmount) || 0;
      let sCash = Number(s.cashPaid !== undefined ? s.cashPaid : (String(s.paymentMethod || '').toUpperCase() === 'CASH' ? sTotal : 0));
      let sBank = Number(s.bankPaid !== undefined ? s.bankPaid : (String(s.paymentMethod || '').toUpperCase().includes('BANK') ? sTotal : 0));

      if (isToBank && sCash > 0) {
        const move = Math.min(sCash, remainingToMove);
        const newCash = sCash - move;
        const newBank = sBank + move;
        const newMethod = newCash === 0 ? 'BANK' : 'SPLIT';

        totalMoved += move;
        remainingToMove -= move;

        try {
          await Sale.findByIdAndUpdate(s.id || s._id, { cashPaid: newCash, bankPaid: newBank, paymentMethod: newMethod });
          await pool.query(
            `UPDATE \`${pfx}__sales\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`id\` = ?`,
            [newCash, newBank, newMethod, s.id]
          );
          await pool.query(
            `UPDATE \`${pfx}__customer_payment_ledger\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`saleId\` = ? OR \`invoiceNumber\` = ?`,
            [newCash, newBank, newMethod, String(s.id), s.invoiceNumber]
          );
          await pool.query(
            `UPDATE \`${pfx}__today_sales_history\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`saleId\` = ? OR \`invoiceNumber\` = ?`,
            [newCash, newBank, newMethod, String(s.id), s.invoiceNumber]
          );
        } catch (_) {}
      } else if (!isToBank && sBank > 0) {
        const move = Math.min(sBank, remainingToMove);
        const newBank = sBank - move;
        const newCash = sCash + move;
        const newMethod = newBank === 0 ? 'CASH' : 'SPLIT';

        totalMoved += move;
        remainingToMove -= move;

        try {
          await Sale.findByIdAndUpdate(s.id || s._id, { cashPaid: newCash, bankPaid: newBank, paymentMethod: newMethod });
          await pool.query(
            `UPDATE \`${pfx}__sales\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`id\` = ?`,
            [newCash, newBank, newMethod, s.id]
          );
          await pool.query(
            `UPDATE \`${pfx}__customer_payment_ledger\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`saleId\` = ? OR \`invoiceNumber\` = ?`,
            [newCash, newBank, newMethod, String(s.id), s.invoiceNumber]
          );
          await pool.query(
            `UPDATE \`${pfx}__today_sales_history\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`saleId\` = ? OR \`invoiceNumber\` = ?`,
            [newCash, newBank, newMethod, String(s.id), s.invoiceNumber]
          );
        } catch (_) {}
      }
    }

    // If more amount remains to be transferred, look in all sales for this shop
    if (remainingToMove > 0 && remainingToMove !== Infinity) {
      try {
        const allSales = await Sale.find({ shopId: realShopId }).sort({ saleDate: -1, createdAt: -1 });
        for (const s of allSales) {
          if (remainingToMove <= 0) break;
          const sTotal = Number(s.totalAmount) || 0;
          let sCash = Number(s.cashPaid !== undefined ? s.cashPaid : (String(s.paymentMethod || '').toUpperCase() === 'CASH' ? sTotal : 0));
          let sBank = Number(s.bankPaid !== undefined ? s.bankPaid : (String(s.paymentMethod || '').toUpperCase().includes('BANK') ? sTotal : 0));

          if (isToBank && sCash > 0) {
            const move = Math.min(sCash, remainingToMove);
            const newCash = sCash - move;
            const newBank = sBank + move;
            const newMethod = newCash === 0 ? 'BANK' : 'SPLIT';
            totalMoved += move;
            remainingToMove -= move;
            await Sale.findByIdAndUpdate(s.id || s._id, { cashPaid: newCash, bankPaid: newBank, paymentMethod: newMethod });
            await pool.query(`UPDATE \`${pfx}__sales\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`id\` = ?`, [newCash, newBank, newMethod, s.id]).catch(() => {});
            await pool.query(`UPDATE \`${pfx}__customer_payment_ledger\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`saleId\` = ? OR \`invoiceNumber\` = ?`, [newCash, newBank, newMethod, String(s.id), s.invoiceNumber]).catch(() => {});
          } else if (!isToBank && sBank > 0) {
            const move = Math.min(sBank, remainingToMove);
            const newBank = sBank - move;
            const newCash = sCash + move;
            const newMethod = newBank === 0 ? 'CASH' : 'SPLIT';
            totalMoved += move;
            remainingToMove -= move;
            await Sale.findByIdAndUpdate(s.id || s._id, { cashPaid: newCash, bankPaid: newBank, paymentMethod: newMethod });
            await pool.query(`UPDATE \`${pfx}__sales\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`id\` = ?`, [newCash, newBank, newMethod, s.id]).catch(() => {});
            await pool.query(`UPDATE \`${pfx}__customer_payment_ledger\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`saleId\` = ? OR \`invoiceNumber\` = ?`, [newCash, newBank, newMethod, String(s.id), s.invoiceNumber]).catch(() => {});
          }
        }
      } catch (_) {}
    }

    res.json({
      success: true,
      message: `Transferred Rs. ${totalMoved.toLocaleString('en-PK')} from ${isToBank ? 'Cash Drawer to Bank' : 'Bank to Cash Drawer'} successfully`,
      totalMoved,
      dest
    });
  } catch (err) {
    console.error('Transfer drawer funds error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 1-CLICK BULK TRANSFER PURCHASES / VENDOR FUNDS (CASH PAID <-> BANK PAID) ──
router.post('/transfer-purchase-funds', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const { shopId, targetMethod, target, amount, timeframe = 'ALL' } = req.body;
    const dest = String(targetMethod || target || 'BANK').toUpperCase();
    const isToBank = dest === 'BANK' || dest === 'BANK_TRANSFER' || dest === 'ONLINE';

    const rawShopId = shopId || req.user?.shopId;
    const realShopId = await resolveShopId(rawShopId) || Number(rawShopId) || 1;
    const pfx = BRANCH_TABLE_PREFIXES[realShopId] || 'peshawar_branch';

    const mysqlModule = await import('../config/mysql.js');
    const pool = mysqlModule.default;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    let query = { shopId: realShopId };
    if (timeframe === 'DAY' || timeframe === 'TODAY') {
      query.$or = [
        { purchaseDate: { $gte: new Date(todayStr) } },
        { createdAt: { $gte: new Date(todayStr) } }
      ];
    }

    let purchases = await Item.find(query);
    if (purchases.length === 0) {
      try {
        const [rows] = await pool.query(
          timeframe === 'DAY' || timeframe === 'TODAY'
            ? `SELECT * FROM \`${pfx}__purchases\` WHERE DATE(\`purchaseDate\`) = ? OR DATE(\`createdAt\`) = ?`
            : `SELECT * FROM \`${pfx}__purchases\``,
          timeframe === 'DAY' || timeframe === 'TODAY' ? [todayStr, todayStr] : []
        );
        purchases = rows || [];
      } catch (_) {}
    }

    let remainingToMove = amount ? Number(amount) : Infinity;
    let totalMoved = 0;

    for (const p of purchases) {
      if (remainingToMove <= 0) break;
      const pCost = Number(p.totalPurchaseCost || p.costPrice || 0);
      let pCash = Number(p.cashPaidToSupplier !== undefined ? p.cashPaidToSupplier : (p.cashPaid !== undefined ? p.cashPaid : 0));
      let pBank = Number(p.bankPaidToSupplier !== undefined ? p.bankPaidToSupplier : (p.bankPaid !== undefined ? p.bankPaid : 0));

      if (isToBank && (pCash > 0 || (pBank === 0 && String(p.paymentMethod || '').toLowerCase() === 'cash'))) {
        if (pCash === 0 && pBank === 0) pCash = pCost;
        const move = Math.min(pCash, remainingToMove);
        const newCash = pCash - move;
        const newBank = pBank + move;
        const newMethod = newCash === 0 ? 'BANK' : (newBank === 0 ? 'CASH' : 'SPLIT');

        totalMoved += move;
        remainingToMove -= move;

        try {
          await Item.findByIdAndUpdate(p.id || p._id, {
            cashPaidToSupplier: newCash,
            bankPaidToSupplier: newBank,
            paymentMethod: newMethod
          });
          await pool.query(
            `UPDATE \`${pfx}__purchases\` SET \`cashPaid\` = ?, \`paymentMethod\` = ? WHERE \`id\` = ?`,
            [newCash, newMethod, p.id]
          );
          await pool.query(
            `UPDATE \`${pfx}__vendor_payment_ledger\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`purchaseId\` = ? OR \`id\` = ?`,
            [newCash, newBank, newMethod, p.id, p.id]
          );
        } catch (_) {}
      } else if (!isToBank && (pBank > 0 || (pCash === 0 && String(p.paymentMethod || '').toLowerCase().includes('bank')))) {
        if (pCash === 0 && pBank === 0) pBank = pCost;
        const move = Math.min(pBank, remainingToMove);
        const newBank = pBank - move;
        const newCash = pCash + move;
        const newMethod = newBank === 0 ? 'CASH' : (newCash === 0 ? 'BANK' : 'SPLIT');

        totalMoved += move;
        remainingToMove -= move;

        try {
          await Item.findByIdAndUpdate(p.id || p._id, {
            cashPaidToSupplier: newCash,
            bankPaidToSupplier: newBank,
            paymentMethod: newMethod
          });
          await pool.query(
            `UPDATE \`${pfx}__purchases\` SET \`cashPaid\` = ?, \`paymentMethod\` = ? WHERE \`id\` = ?`,
            [newCash, newMethod, p.id]
          );
          await pool.query(
            `UPDATE \`${pfx}__vendor_payment_ledger\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`purchaseId\` = ? OR \`id\` = ?`,
            [newCash, newBank, newMethod, p.id, p.id]
          );
        } catch (_) {}
      }
    }

    res.json({
      success: true,
      message: `Transferred Rs. ${totalMoved.toLocaleString('en-PK')} of purchase payments to ${isToBank ? 'Bank' : 'Cash'} successfully`,
      totalMoved,
      dest
    });
  } catch (err) {
    console.error('Transfer purchase funds error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 1-CLICK INSTANT PAYMENT CHANNEL TRANSFER FOR VENDOR BILL ──
router.patch('/vendor-payment-ledger/:id/transfer-channel', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { targetMethod, target, amount } = req.body;
    const dest = String(targetMethod || target || 'BANK').toUpperCase();
    const isToBank = dest === 'BANK' || dest === 'BANK_TRANSFER' || dest === 'ONLINE';

    let bill = await VendorPaymentLedger.findById(id);
    if (!bill) {
      bill = await VendorPaymentLedger.findOne({ purchaseId: id });
    }

    const rawShopId = bill?.shopId || req.user?.shopId || 1;
    const realShopId = await resolveShopId(rawShopId) || Number(rawShopId) || 1;
    const pfx = BRANCH_TABLE_PREFIXES[realShopId] || 'peshawar_branch';

    const mysqlModule = await import('../config/mysql.js');
    const pool = mysqlModule.default;

    let totalCost = Number(bill?.totalCost || 0);
    let oldCash = Number(bill?.cashPaid || 0);
    let oldBank = Number(bill?.bankPaid || 0);

    if (!bill) {
      // Look in MySQL table
      try {
        const [rows] = await pool.query(`SELECT * FROM \`${pfx}__vendor_payment_ledger\` WHERE \`id\` = ? OR \`purchaseId\` = ?`, [id, id]);
        if (rows && rows.length > 0) {
          const r = rows[0];
          totalCost = Number(r.totalCost || 0);
          oldCash = Number(r.cashPaid || 0);
          oldBank = Number(r.bankPaid || 0);
        }
      } catch (_) {}
    }

    let newCash = oldCash;
    let newBank = oldBank;
    let movedAmount = 0;

    if (isToBank) {
      const avail = oldCash > 0 ? oldCash : totalCost;
      movedAmount = amount ? Math.min(Number(amount), avail) : avail;
      newCash = Math.max(0, avail - movedAmount);
      newBank = oldBank + movedAmount;
    } else {
      const avail = oldBank > 0 ? oldBank : totalCost;
      movedAmount = amount ? Math.min(Number(amount), avail) : avail;
      newBank = Math.max(0, avail - movedAmount);
      newCash = oldCash + movedAmount;
    }

    const newMethod = newCash > 0 && newBank > 0 ? 'SPLIT' : (newBank > 0 ? 'BANK' : 'CASH');

    try {
      await pool.query(
        `UPDATE \`${pfx}__vendor_payment_ledger\` SET \`cashPaid\` = ?, \`bankPaid\` = ?, \`paymentMethod\` = ? WHERE \`id\` = ? OR \`purchaseId\` = ?`,
        [newCash, newBank, newMethod, id, id]
      );
    } catch (_) {}

    try {
      await pool.query(
        `UPDATE \`${pfx}__purchases\` SET \`cashPaid\` = ?, \`paymentMethod\` = ? WHERE \`id\` = ?`,
        [newCash, newMethod, id]
      );
    } catch (_) {}

    try {
      await VendorPaymentLedger.findByIdAndUpdate(id, { cashPaid: newCash, bankPaid: newBank, paymentMethod: newMethod });
      await VendorPaymentLedger.findOneAndUpdate({ purchaseId: id }, { cashPaid: newCash, bankPaid: newBank, paymentMethod: newMethod });
    } catch (_) {}

    // Also update Item model if linked
    try {
      const it = await Item.findById(id);
      if (it) {
        await Item.findByIdAndUpdate(id, {
          cashPaidToSupplier: newCash,
          bankPaidToSupplier: newBank,
          paymentMethod: newMethod
        });
      }
    } catch (_) {}

    res.json({
      success: true,
      message: `Transferred purchase payment of Rs. ${movedAmount.toLocaleString('en-PK')} to ${isToBank ? 'Bank' : 'Cash'} successfully`,
      newCash,
      newBank,
      newMethod
    });
  } catch (err) {
    console.error('Transfer vendor payment channel error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── UPDATE CUSTOMER DETAILS ACROSS SALES ──
router.put('/update-customer-info', async (req, res) => {
  try {
    const { saleIds, oldCustomerName, oldCustomerPhone, oldCustomerEmail, newCustomerName, newCustomerPhone, newCustomerEmail } = req.body;
    
    const updateFields = {};
    if (newCustomerName) updateFields.customerName = newCustomerName.trim();
    if (newCustomerPhone !== undefined) updateFields.customerPhone = newCustomerPhone.trim();
    if (newCustomerEmail !== undefined) updateFields.customerEmail = newCustomerEmail.trim().toLowerCase();

    const queryOr = [];
    if (Array.isArray(saleIds) && saleIds.length > 0) {
      queryOr.push({ _id: { $in: saleIds } });
    }
    if (oldCustomerName && oldCustomerName.trim()) {
      queryOr.push({ customerName: new RegExp(`^${oldCustomerName.trim()}$`, 'i') });
    }
    if (oldCustomerPhone && oldCustomerPhone.trim()) {
      queryOr.push({ customerPhone: oldCustomerPhone.trim() });
    }
    if (oldCustomerEmail && oldCustomerEmail.trim() && oldCustomerEmail !== 'physical store pos') {
      queryOr.push({ customerEmail: oldCustomerEmail.trim().toLowerCase() });
    }

    if (queryOr.length > 0) {
      await Sale.updateMany(
        { $or: queryOr },
        { $set: updateFields }
      );
      try {
        await CustomerPaymentLedger.updateMany(
          { $or: queryOr },
          { $set: updateFields }
        );
      } catch (cplErr) {
        console.warn('CustomerPaymentLedger update warning:', cplErr.message);
      }
    }

    res.json({ success: true, message: 'Customer details updated successfully across sales' });
  } catch (err) {
    console.error('Update sales customer info error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET CUSTOMER CREDITS FROM DATABASE ──
router.get('/customer-credits', authenticate, async (req, res) => {
  try {
    const rawShopId = req.query.shopId || req.user?.shopId;
    const targetShopId = rawShopId ? (await resolveShopId(rawShopId) || rawShopId) : null;
    const pfx = (targetShopId && BRANCH_TABLE_PREFIXES[targetShopId]) || 'peshawar_branch';
    const mysqlModule = await import('../config/mysql.js');
    const pool = mysqlModule.default;

    // Fetch from branch table
    try {
      const [rows] = await pool.query(`SELECT * FROM \`${pfx}__customer_credits\` ORDER BY \`createdAt\` DESC`);
      if (rows && rows.length > 0) {
        return res.json(rows.map(r => ({
          ...r,
          _id: r.id,
          totalAmount: Number(r.totalAmount) || 0,
          paidAmount: Number(r.paidAmount) || 0,
          dueAmount: Number(r.dueAmount) || 0
        })));
      }
    } catch (_) {}

    // Fallback to BaseModel / MongoDB
    let query = {};
    if (targetShopId) {
      query.shopId = targetShopId;
    }
    const credits = await CustomerCredit.find(query).lean();
    res.json(credits);
  } catch (error) {
    console.error('[getCustomerCredits error]', error);
    res.status(500).json({ message: error.message });
  }
});

// ── DELETE CUSTOMER CREDIT RECORD ──
router.delete('/customer-credit/:id', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const creditId = id || req.body?.id || req.body?.creditId || req.body?.saleId;
    if (!creditId || creditId === 'undefined' || creditId === 'null') {
      return res.status(400).json({ message: 'Valid ID is required' });
    }

    try {
      await CustomerCredit.findByIdAndDelete(creditId);
      await CustomerCredit.deleteMany({ saleId: creditId });
    } catch (ccErr) {
      console.error('[deleteCustomerCredit] CustomerCredit delete error:', ccErr.message);
    }

    res.json({ success: true, message: 'Customer credit record deleted successfully', deletedId: creditId });
  } catch (error) {
    console.error('[deleteCustomerCredit error]', error);
    res.status(500).json({ message: error.message });
  }
});

// ── GET RECEIVED CHEQUES ──
router.get('/received-cheques', authenticate, async (req, res) => {
  try {
    const rawShopId = req.query.shopId || req.user?.shopId || 1;
    const targetShopId = (await resolveShopId(rawShopId)) || Number(rawShopId) || 1;
    const pfx = BRANCH_TABLE_PREFIXES[targetShopId] || 'peshawar_branch';
    const channel = String(req.query.channel || 'ALL').toUpperCase();

    let sql = `SELECT * FROM \`${pfx}__received_cheques\``;
    const params = [];
    if (channel === 'CASH' || channel === 'BANK') {
      sql += ` WHERE \`channel\` = ?`;
      params.push(channel);
    }
    sql += ` ORDER BY \`chequeDate\` DESC, \`id\` DESC`;

    const [rows] = await pool.query(sql, params).catch(() => [[]]);
    res.json(rows || []);
  } catch (err) {
    console.error('[getReceivedCheques error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── CREATE RECEIVED CHEQUE (CASH / BANK) ──
router.post('/received-cheques', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const {
      channel = 'CASH',
      chequeNumber,
      bankName = 'Bank',
      customerName = 'Customer',
      customerPhone = '',
      amount,
      status = 'CLEARED',
      chequeDate,
      notes = '',
      shopId: explicitShopId
    } = req.body;

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    if (!chequeNumber || !String(chequeNumber).trim()) {
      return res.status(400).json({ success: false, message: 'Cheque number is required' });
    }

    const rawShopId = explicitShopId || req.user?.shopId || 1;
    const targetShopId = (await resolveShopId(rawShopId)) || Number(rawShopId) || 1;
    const pfx = BRANCH_TABLE_PREFIXES[targetShopId] || 'peshawar_branch';

    const chqChannel = String(channel).toUpperCase() === 'BANK' ? 'BANK' : 'CASH';
    const chqStatus = String(status).toUpperCase() === 'PENDING' ? 'PENDING' : 'CLEARED';
    const cleanChqNum = String(chequeNumber).trim();
    const cleanBank = String(bankName).trim();
    const cleanCust = String(customerName).trim();
    const cleanPhone = String(customerPhone || '').trim();
    const chqDateStr = chequeDate ? new Date(chequeDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    const invNum = `CHQ-${cleanChqNum.replace(/[^a-zA-Z0-9-]/g, '') || Date.now()}`;

    // Insert into received_cheques table (money drawn / received via cheque)
    const [chqRes] = await pool.query(
      `INSERT INTO \`${pfx}__received_cheques\`
         (\`shopId\`, \`channel\`, \`chequeNumber\`, \`bankName\`, \`customerName\`, \`customerPhone\`,
          \`amount\`, \`status\`, \`chequeDate\`, \`clearedDate\`, \`saleId\`, \`invoiceNumber\`,
          \`notes\`, \`receivedBy\`, \`createdAt\`, \`updatedAt\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NOW(), NOW())`,
      [
        targetShopId, chqChannel, cleanChqNum, cleanBank, cleanCust, cleanPhone,
        amt, chqStatus, chqDateStr, chqStatus === 'CLEARED' ? new Date() : null,
        invNum, notes || '', req.user?.username || req.user?.name || 'Admin'
      ]
    );

    res.json({
      success: true,
      message: `Cheque of Rs. ${amt.toLocaleString('en-PK')} received successfully into ${chqChannel === 'BANK' ? 'Bank Account' : 'Cash Drawer'}!`,
      chequeId: chqRes.insertId,
      saleId: null,
      channel: chqChannel,
      amount: amt
    });
  } catch (err) {
    console.error('[createReceivedCheque error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE RECEIVED CHEQUE ──
router.delete('/received-cheques/:id', authenticate, requireShopAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rawShopId = req.body?.shopId || req.query?.shopId || req.user?.shopId || 1;
    const targetShopId = (await resolveShopId(rawShopId)) || Number(rawShopId) || 1;
    const pfx = BRANCH_TABLE_PREFIXES[targetShopId] || 'peshawar_branch';

    const [rows] = await pool.query(`SELECT * FROM \`${pfx}__received_cheques\` WHERE \`id\` = ?`, [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cheque record not found' });
    }
    const cheque = rows[0];

    // Delete linked sale if exists
    if (cheque.saleId) {
      try {
        await pool.query(`DELETE FROM \`${pfx}__sales\` WHERE \`id\` = ?`, [cheque.saleId]);
        await pool.query(`DELETE FROM \`${pfx}__today_sales_history\` WHERE \`saleId\` = ?`, [String(cheque.saleId)]);
        await pool.query(`DELETE FROM \`${pfx}__customer_payment_ledger\` WHERE \`saleId\` = ?`, [String(cheque.saleId)]);
      } catch (_) {}
    } else if (cheque.invoiceNumber) {
      try {
        await pool.query(`DELETE FROM \`${pfx}__sales\` WHERE \`invoiceNumber\` = ?`, [cheque.invoiceNumber]);
        await pool.query(`DELETE FROM \`${pfx}__today_sales_history\` WHERE \`invoiceNumber\` = ?`, [cheque.invoiceNumber]);
        await pool.query(`DELETE FROM \`${pfx}__customer_payment_ledger\` WHERE \`invoiceNumber\` = ?`, [cheque.invoiceNumber]);
      } catch (_) {}
    }

    await pool.query(`DELETE FROM \`${pfx}__received_cheques\` WHERE \`id\` = ?`, [id]);

    res.json({
      success: true,
      message: 'Cheque record and associated inflow removed successfully',
      deletedId: id
    });
  } catch (err) {
    console.error('[deleteReceivedCheque error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
