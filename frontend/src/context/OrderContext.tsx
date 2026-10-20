import { createContext, useContext, useEffect, useReducer, type ReactNode, type Dispatch } from 'react';
import type { User } from '@supabase/supabase-js';
import type { ProductType, PackSize, OrderFormData, OrderSummary, Order, PaymentStatus, Product, CheckoutQuote } from '../types/orders';
import { PRODUCT_SHELL, getErrorMessage } from '../lib/api';
import { PACK_SIZE_PATTERN, PRODUCT_SLUG_PATTERN } from '../constants/store';
import { fetchProducts } from '../features/catalog/api/catalogApi';
import { getCheckoutQuote, getOrder } from '../features/orders/api/ordersApi';
import { normalizeIndianMobile, readCustomerDetails, validateCustomerDetails } from '../lib/customer';

export interface OrderState extends OrderFormData {
  checkoutKey: string;
  orderLoadStatus: string;
  orderLoadAttempt: number;
  orderId: string;
  orderNumber: string;
  serverOrder: Order | null;
  screenshotFile: File | null;
  screenshotPreview: string;
  paymentStatus: PaymentStatus | null;
  products: Product[];
  catalogStatus: string;
  quote: CheckoutQuote | null;
  quoteStatus: string;
}

export const initialState: OrderState = {
  product: 'faki', packSize: '250g', quantity: 1,
  fullName: '', phone: '', address: '', pinCode: '',
  checkoutKey: '', orderLoadStatus: '', orderLoadAttempt: 0,
  orderId: '', orderNumber: '', serverOrder: null,
  screenshotFile: null, screenshotPreview: '', paymentStatus: null,
  products: PRODUCT_SHELL, catalogStatus: 'Loading current prices…', quote: null, quoteStatus: '',
};

const orderReset = {
  checkoutKey: '', orderLoadStatus: '',
  orderId: '', orderNumber: '', serverOrder: null, paymentStatus: null,
  screenshotFile: null, screenshotPreview: '',
};

export type Action =
  | { type: 'SET_PRODUCT'; payload: ProductType }
  | { type: 'SET_PACK_SIZE'; payload: PackSize }
  | { type: 'SET_QUANTITY'; payload: number }
  | { type: 'SET_FIELD'; payload: { field: 'fullName' | 'phone' | 'address' | 'pinCode'; value: string } }
  | { type: 'SET_SERVER_ORDER'; payload: Order }
  | { type: 'SET_PAYMENT_STATUS'; payload: PaymentStatus }
  | { type: 'SET_SCREENSHOT'; payload: { file: File | null; preview: string } }
  | { type: 'SET_CATALOG'; payload: { products: Product[]; status: string } }
  | { type: 'SET_QUOTE'; payload: { quote: CheckoutQuote | null; status: string } }
  | { type: 'SET_CHECKOUT_KEY'; payload: string }
  | { type: 'SET_ORDER_LOAD_STATUS'; payload: string }
  | { type: 'RETRY_ORDER' }
  | { type: 'RESET_SERVER' }
  | { type: 'RESET' };

export const MAX_QUANTITY = 20;

/** First pack size that currently has a price, else the first one (never a hard-coded size). */
function defaultPackSize(products: Product[], type: ProductType): PackSize {
  const product = products.find((item) => item.type === type);
  return product?.packSizes.find((size) => product.prices[size] != null) ?? product?.packSizes[0] ?? '250g';
}

export function reducer(state: OrderState, action: Action): OrderState {
  switch (action.type) {
    case 'SET_PRODUCT':
      if (state.product === action.payload) return state;
      return { ...state, ...orderReset, product: action.payload, packSize: defaultPackSize(state.products, action.payload), quote: null };
    case 'SET_PACK_SIZE':
      return { ...state, ...orderReset, packSize: action.payload, quote: null };
    case 'SET_QUANTITY':
      if (!Number.isFinite(action.payload)) return state;
      return { ...state, ...orderReset, quantity: Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(action.payload))), quote: null };
    case 'SET_FIELD':
      return { ...state, ...orderReset, [action.payload.field]: action.payload.value, quote: action.payload.field === 'pinCode' ? null : state.quote };
    case 'SET_SERVER_ORDER':
      return { ...state, orderLoadStatus: '', orderId: action.payload.id, orderNumber: action.payload.orderNumber, serverOrder: action.payload, paymentStatus: action.payload.paymentStatus };
    case 'SET_PAYMENT_STATUS':
      return { ...state, paymentStatus: action.payload };
    case 'SET_SCREENSHOT':
      return { ...state, screenshotFile: action.payload.file, screenshotPreview: action.payload.preview };
    case 'SET_CATALOG': {
      // A saved draft can name a product or pack size the catalogue no longer has: fall back to a real one.
      const { products } = action.payload;
      const product = products.find((item) => item.type === state.product) ?? products[0];
      const packSize = product?.packSizes.includes(state.packSize) ? state.packSize : defaultPackSize(products, product?.type ?? state.product);
      return { ...state, products, catalogStatus: action.payload.status, ...(product ? { product: product.type, packSize } : {}) };
    }
    case 'SET_QUOTE':
      return { ...state, quote: action.payload.quote, quoteStatus: action.payload.status };
    case 'SET_CHECKOUT_KEY':
      return { ...state, checkoutKey: action.payload };
    case 'SET_ORDER_LOAD_STATUS':
      return { ...state, orderLoadStatus: action.payload };
    case 'RETRY_ORDER':
      return { ...state, orderLoadAttempt: state.orderLoadAttempt + 1 };
    case 'RESET_SERVER':
      return { ...state, ...orderReset };
    case 'RESET':
      return { ...initialState, fullName: state.fullName, phone: state.phone, products: state.products, catalogStatus: state.catalogStatus };
  }
}

export function buildSummary(state: OrderState): OrderSummary {
  const product = state.products.find(p => p.type === state.product) ?? PRODUCT_SHELL[0];
  const server = state.serverOrder;
  const quote = server ?? state.quote;
  const price = product.prices[state.packSize];
  return {
    product: server?.product ?? state.product,
    productName: server?.productName ?? product.name,
    productNameGu: state.products.find(p => p.type === (server?.product ?? state.product))?.nameGu ?? '',
    packSize: server?.packSize ?? state.packSize,
    quantity: server?.quantity ?? state.quantity,
    subtotal: quote?.subtotal ?? (price != null ? price * state.quantity : null),
    deliveryFee: quote?.deliveryFee ?? null,
    total: quote?.total ?? null,
  };
}

export type FormErrors = Partial<Record<keyof OrderFormData, string>>;

export function validateForm(state: OrderFormData): FormErrors {
  const errors: FormErrors = { ...validateCustomerDetails(state) };
  if (!PRODUCT_SLUG_PATTERN.test(state.product)) errors.product = 'Choose a product';
  if (!PACK_SIZE_PATTERN.test(state.packSize)) errors.packSize = 'Choose an available pack size';
  if (!Number.isInteger(state.quantity) || state.quantity < 1 || state.quantity > MAX_QUANTITY) errors.quantity = `Choose a quantity between 1 and ${MAX_QUANTITY}`;
  const address = state.address.trim();
  if (!address) errors.address = 'Delivery address is required';
  else if (address.length < 10) errors.address = 'Add house no., society and area';
  if (!/^[1-9][0-9]{5}$/.test(state.pinCode)) errors.pinCode = 'Enter a valid 6-digit PIN code';
  return errors;
}

export function toOrderFormData(state: OrderFormData): OrderFormData {
  return { product: state.product, packSize: state.packSize, quantity: state.quantity,
    fullName: state.fullName.trim(), phone: `+91${normalizeIndianMobile(state.phone)}`,
    address: state.address.trim(), pinCode: state.pinCode };
}

const STORAGE_KEY = 'bfp-order-session';

// Only the draft and an opaque order reference survive refresh; status must be fetched again.
export function restoreDraft(raw: string | null): OrderState {
  if (!raw) return { ...initialState };
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return { ...initialState };
    const data = saved as Record<string, unknown>;
    const draft = { ...initialState };
    if (typeof data.product === 'string' && PRODUCT_SLUG_PATTERN.test(data.product)) draft.product = data.product;
    if (typeof data.packSize === 'string' && PACK_SIZE_PATTERN.test(data.packSize)) draft.packSize = data.packSize;
    if (typeof data.quantity === 'number' && Number.isInteger(data.quantity) && data.quantity >= 1 && data.quantity <= MAX_QUANTITY) draft.quantity = data.quantity;
    for (const field of ['fullName', 'phone', 'address', 'pinCode', 'orderId', 'checkoutKey'] as const) {
      if (typeof data[field] === 'string') draft[field] = data[field].slice(0, 2000);
    }
    draft.phone = normalizeIndianMobile(draft.phone);
    return draft;
  } catch { return { ...initialState }; }
}

export function persistDraft(state: OrderState, userId: string) {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.setItem(`${STORAGE_KEY}:${userId}`, JSON.stringify({ ...toOrderFormData(state), orderId: state.orderId, checkoutKey: state.checkoutKey }));
  }
  catch { /* Unavailable storage still permits in-memory checkout. */ }
}

export const GUEST_DRAFT_ID = 'guest';

/** True when a visitor has already chosen something worth keeping across the sign-in step. */
export function hasDraftContent(draft: OrderFormData): boolean {
  return Boolean(
    draft.product !== initialState.product || draft.packSize !== initialState.packSize || draft.quantity !== initialState.quantity ||
    draft.fullName.trim() || draft.phone.trim() || draft.address.trim() || draft.pinCode.trim(),
  );
}

/**
 * Visitors build a draft without an account. When they sign in, a draft they prepared as a guest wins over any older
 * saved draft of that account, so they land back in checkout with what they chose. Another account's draft is never read.
 */
export function loadState(user: User | null) {
  const profile = readCustomerDetails(user?.user_metadata);
  let draft = { ...initialState };
  try {
    const guest = restoreDraft(sessionStorage.getItem(`${STORAGE_KEY}:${GUEST_DRAFT_ID}`));
    if (!user) draft = guest;
    else if (hasDraftContent(guest)) {
      draft = { ...guest, orderId: '', checkoutKey: '' };
      sessionStorage.removeItem(`${STORAGE_KEY}:${GUEST_DRAFT_ID}`);
    } else draft = restoreDraft(sessionStorage.getItem(`${STORAGE_KEY}:${user.id}`));
  }
  catch { /* Unavailable storage still permits in-memory checkout. */ }
  return { ...draft, fullName: draft.fullName || profile.fullName, phone: draft.phone || profile.phone };
}

const OrderContext = createContext<OrderState>(initialState);
const DispatchContext = createContext<Dispatch<Action>>(() => {});

export function OrderProvider({ children, user }: { children: ReactNode; user: User | null }) {
  const [state, dispatch] = useReducer(reducer, user, loadState);
  const draftOwner = user?.id ?? GUEST_DRAFT_ID;
  useEffect(() => { persistDraft(state, draftOwner); }, [state, draftOwner]);
  useEffect(() => () => {
    if (state.screenshotPreview) URL.revokeObjectURL(state.screenshotPreview);
  }, [state.screenshotPreview]);
  useEffect(() => {
    let active = true;
    fetchProducts().then(products => {
      if (active) dispatch({ type: 'SET_CATALOG', payload: { products, status: products.length ? '' : 'No products are currently available. Please contact the store.' } });
    }).catch(() => {
      if (active) dispatch({ type: 'SET_CATALOG', payload: { products: PRODUCT_SHELL, status: 'Current prices are unavailable right now. Please try again shortly or contact the store.' } });
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    dispatch({ type: 'SET_QUOTE', payload: { quote: null, status: '' } });
    if (!/^[1-9]\d{5}$/.test(state.pinCode)) return;
    dispatch({ type: 'SET_QUOTE', payload: { quote: null, status: 'Checking current totals…' } });
    getCheckoutQuote({ product: state.product, packSize: state.packSize, quantity: state.quantity, pinCode: state.pinCode })
      .then(quote => { if (active) dispatch({ type: 'SET_QUOTE', payload: { quote, status: '' } }); })
      .catch(error => { if (active) dispatch({ type: 'SET_QUOTE', payload: { quote: null, status: getErrorMessage(error) } }); });
    return () => { active = false; };
  }, [state.product, state.packSize, state.quantity, state.pinCode]);
  useEffect(() => {
    let active = true;
    if (user && state.orderId && !state.serverOrder) {
      dispatch({ type: 'SET_ORDER_LOAD_STATUS', payload: 'Loading your existing order…' });
      getOrder(state.orderId).then(order => {
        if (active) dispatch({ type: 'SET_SERVER_ORDER', payload: order });
      }).catch(error => { if (active) dispatch({ type: 'SET_ORDER_LOAD_STATUS', payload: getErrorMessage(error) }); });
    }
    return () => { active = false; };
  }, [user?.id, state.orderId, Boolean(state.serverOrder), state.orderLoadAttempt]);
  return <OrderContext.Provider value={state}><DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider></OrderContext.Provider>;
}

export function useOrder() { return useContext(OrderContext); }
export function useOrderDispatch() { return useContext(DispatchContext); }
