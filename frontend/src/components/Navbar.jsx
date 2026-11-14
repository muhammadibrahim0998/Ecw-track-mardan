import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, ShoppingCart, Receipt, Download, LogOut, TrendingUp, Menu, Store, Plus } from 'lucide-react';
import { useShift } from '../contexts/ShiftContext';
import { useUser } from '../contexts/UserContext';
import { useSettings } from '../contexts/SettingsContext';
import { useProducts } from '../contexts/ProductContext';
import companyLogo from '../image/logo.png';

export function Navbar({
  isCollapsed,
  onToggleSidebar,
  cartCount,
  onCartClick,
  onAddProduct,
  onNewSale,
  onExport,
  onShiftClick,
  dailySales,
  monthlySales,
  yearlySales,
  dailyProfit,
  monthlyProfit,
  yearlyProfit,
  onMenuClick,
  onSearchToggle,
  user
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentSession } = useShift();
  const { logout, isSuperAdmin, isShopAdmin, isCustomer } = useUser();
  const { settings } = useSettings();
  const { searchTerm, setSearchTerm } = useProducts();
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const fmt = (n) => `${settings.currency || 'Rs.'} ${(n || 0).toLocaleString('en-PK')}`;
  const shopName = settings?.shopName || 'NexFlow';
  const logoUrl = settings?.logoUrl || null;

  return (
    <nav className="sticky top-0 z-50 w-full bg-gradient-to-r from-[#172554] via-[#1e40af] to-[#1d4ed8] backdrop-blur-xl border-b-2 border-b-amber-400/40 shadow-[0_6px_22px_rgba(234,179,8,0.28),0_12px_30px_rgba(239,68,68,0.2),0_4px_18px_rgba(34,197,94,0.22)] transition-all duration-300">
      <div className="flex items-center justify-between h-20 gap-2 sm:gap-4 px-4 sm:px-6 max-w-[1600px] mx-auto">

        {/* Left: Branding */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              if (window.innerWidth >= 768) {
                if (onToggleSidebar) onToggleSidebar();
              } else {
                if (onMenuClick) onMenuClick();
              }
            }}
            className="p-2.5 -ml-2 text-white bg-gradient-to-r from-[#1e3a8a] to-[#172554] hover:from-blue-600 hover:to-[#1e3a8a] hover:border-t-amber-300 rounded-xl transition-all duration-300 ease-out shadow-[0_4px_12px_rgba(234,179,8,0.4),0_6px_16px_rgba(239,68,68,0.28),0_0_12px_rgba(34,197,94,0.3)] border-t border-t-white/30 border-b-4 border-b-[#0f172a] hover:shadow-[0_6px_20px_rgba(250,204,21,0.75),0_10px_25px_rgba(239,68,68,0.55),0_0_18px_rgba(34,197,94,0.55)] hover:scale-110 hover:-translate-y-0.5 active:translate-y-[2px] active:scale-95 cursor-pointer"
            aria-label="Toggle Menu"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div
            className="flex items-center gap-3 group cursor-pointer"
            onClick={() => {
              if (isSuperAdmin() || isShopAdmin()) {
                navigate('/');
              } else {
                navigate('/shop');
              }
            }}
          >
            <div className="relative bg-white rounded-xl w-auto max-w-[125px] sm:max-w-[138px] h-10 sm:h-11 flex items-center justify-center shrink-0 shadow-[0_4px_14px_rgba(234,179,8,0.45),0_7px_18px_rgba(239,68,68,0.32),0_0_14px_rgba(34,197,94,0.35)] overflow-hidden border-2 border-white/90 ring-2 ring-amber-400/60 group-hover:ring-emerald-400/80 group-hover:scale-108 group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_24px_rgba(250,204,21,0.8),0_12px_30px_rgba(239,68,68,0.6),0_0_22px_rgba(34,197,94,0.65)] transition-all duration-300 ease-out px-1.5 py-0.5">
              {logoUrl ? (
                <img src={logoUrl} alt={shopName} className="w-full h-full object-contain" />
              ) : (
                <img src={companyLogo} alt="ECW Track POS" className="w-full h-full object-contain" />
              )}
            </div>
            <div className="hidden md:flex flex-col">
              <h1 className="text-base font-black tracking-tight text-yellow-300 group-hover:text-amber-200 uppercase italic drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] group-hover:drop-shadow-[0_0_12px_rgba(251,191,36,0.8)] leading-none transition-all duration-300">
                {user?.role === 'super_admin' || !shopName || shopName === 'Egg Station POS'
                  ? 'ECW TRACK POS'
                  : shopName.toUpperCase()}
              </h1>
              <span className="text-[9px] font-black text-blue-200 group-hover:text-blue-100 uppercase tracking-widest leading-tight mt-1 transition-all duration-300">
                {user?.role === 'super_admin' ? 'SUPER ADMIN' : 'EGGS TRADERS'}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Search Bar with 3D Shadow (Yellow, Red, Green) */}
        <div className="flex-1 flex justify-center max-w-sm mx-auto">
          <div className="relative w-full group">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                if (e.target.value && location.pathname.includes('/category/')) {
                  navigate('/store');
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  navigate('/store');
                }
              }}
              placeholder={isSuperAdmin() ? "Search shops..." : "Search inventory..."}
              className="w-full bg-white/95 backdrop-blur-sm rounded-full py-2.5 flex items-center pl-6 pr-14 text-sm font-black text-gray-900 placeholder:text-gray-500 focus:bg-white focus:ring-2 focus:ring-amber-400/60 hover:bg-white transition-all duration-300 shadow-[inset_0_2px_4px_rgba(0,0,0,0.08),0_4px_14px_rgba(234,179,8,0.35),0_7px_18px_rgba(239,68,68,0.22),0_0_14px_rgba(34,197,94,0.25)] hover:shadow-[0_6px_22px_rgba(250,204,21,0.6),0_10px_26px_rgba(239,68,68,0.4),0_0_18px_rgba(34,197,94,0.45)] focus:shadow-[0_8px_26px_rgba(250,204,21,0.8),0_12px_32px_rgba(239,68,68,0.55),0_0_24px_rgba(34,197,94,0.6)] border-b-2 border-amber-400 focus:border-emerald-500"
            />
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-gradient-to-r from-[#1e3a8a] to-[#172554] hover:from-blue-600 hover:to-blue-800 text-white p-2 rounded-full transition-all duration-300 ease-out shadow-[0_3px_10px_rgba(234,179,8,0.45),0_5px_14px_rgba(239,68,68,0.35),0_0_12px_rgba(34,197,94,0.35)] border-t border-t-white/30 border-b-2 border-b-[#0f172a] hover:shadow-[0_6px_18px_rgba(250,204,21,0.85),0_8px_22px_rgba(239,68,68,0.65),0_0_18px_rgba(34,197,94,0.65)] hover:scale-115 active:scale-95 cursor-pointer"
              onClick={() => {
                if (searchTerm) navigate('/store');
              }}
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Actions with 3D Shadow (Yellow, Red, Green) */}
        <div className="flex items-center gap-3">
          {!isSuperAdmin() && (
            <>
              <button onClick={onShiftClick} className="hidden sm:flex items-center gap-2.5 px-4 py-2.5 rounded-full border-t border-white/30 hover:border-t-amber-300 border-b-4 border-b-[#0f172a] bg-gradient-to-r from-[#1e3a8a] to-[#172554] hover:from-blue-600 hover:to-[#1e3a8a] transition-all duration-300 ease-out shadow-[0_4px_14px_rgba(234,179,8,0.4),0_6px_18px_rgba(239,68,68,0.3),0_0_14px_rgba(34,197,94,0.3)] hover:shadow-[0_8px_24px_rgba(250,204,21,0.8),0_12px_28px_rgba(239,68,68,0.6),0_0_22px_rgba(34,197,94,0.6)] hover:scale-108 hover:-translate-y-0.5 active:translate-y-[2px] cursor-pointer">
                <div className={`w-2.5 h-2.5 rounded-full ${currentSession ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.6)]'}`} />
                <span className="text-xs font-black text-white uppercase tracking-widest">
                  {currentSession?.shiftType || 'No Active Shift'}
                </span>
              </button>

              <div className="h-8 w-px bg-white/30 mx-1 hidden sm:block"></div>

              {(isCustomer() || isShopAdmin() || isSuperAdmin()) && (
                <button
                  onClick={() => {
                    if (onCartClick) onCartClick();
                    else navigate(user?.shopId?._id ? `/shop/${user.shopId._id}` : '/shop');
                  }}
                  className="relative p-3 bg-gradient-to-r from-[#1e3a8a] to-[#172554] hover:from-blue-600 hover:to-blue-800 text-white rounded-full transition-all duration-300 ease-out border-t border-white/30 hover:border-t-amber-300 border-b-4 border-b-[#0f172a] shadow-[0_4px_14px_rgba(234,179,8,0.4),0_6px_18px_rgba(239,68,68,0.3),0_0_14px_rgba(34,197,94,0.3)] hover:shadow-[0_8px_24px_rgba(250,204,21,0.8),0_12px_28px_rgba(239,68,68,0.6),0_0_22px_rgba(34,197,94,0.6)] hover:scale-115 hover:-translate-y-1 active:scale-95 flex items-center justify-center cursor-pointer"
                  title={isShopAdmin() || isSuperAdmin() ? "View Customer Sale & POS Bill Cart" : "View Shopping Cart"}
                >
                  {(isShopAdmin() || isSuperAdmin()) ? (
                    <Receipt className="w-5 h-5 text-amber-300" />
                  ) : (
                    <ShoppingCart className="w-5 h-5 shadow-sm" />
                  )}
                  {cartCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-yellow-400 text-black text-[10px] font-black h-5.5 w-5.5 rounded-full flex items-center justify-center border-2 border-[#1e3a8a] shadow-[0_3px_8px_rgba(0,0,0,0.5)] animate-bounce">
                      {cartCount}
                    </span>
                  )}
                </button>
              )}
            </>
          )}

          <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-4 border-l border-white/30 ml-1 h-12">
            <div className="hidden md:flex flex-col items-end justify-center group cursor-pointer">
              <span className="text-sm font-black text-white italic leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] group-hover:text-amber-300 transition-colors duration-300">{user?.fullName}</span>
              <span className="text-[10px] font-black text-blue-200 uppercase tracking-widest mt-1">{user?.role?.replace('_', ' ')}</span>
            </div>
            <button onClick={logout} className="p-3 bg-gradient-to-r from-[#1e3a8a] to-[#172554] hover:from-rose-600 hover:to-rose-800 text-white rounded-full transition-all duration-300 ease-out border-t border-white/30 hover:border-t-amber-300 border-b-4 border-b-[#0f172a] hover:border-b-rose-950 shadow-[0_4px_14px_rgba(234,179,8,0.4),0_6px_18px_rgba(239,68,68,0.3),0_0_14px_rgba(34,197,94,0.3)] hover:shadow-[0_8px_26px_rgba(250,204,21,0.8),0_12px_30px_rgba(239,68,68,0.65),0_0_22px_rgba(34,197,94,0.6)] hover:scale-115 hover:-translate-y-1 active:scale-95 cursor-pointer">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}