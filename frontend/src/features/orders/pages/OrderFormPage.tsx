import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import OrderStepper from '../../../components/common/OrderStepper';
import Notice from '../../../components/common/Notice';
import MobileNumberInput from '../../../components/common/MobileNumberInput';
import {
  useOrder,
  useOrderDispatch,
  buildSummary,
  validateForm,
  MAX_QUANTITY,
} from '../../../context/OrderContext';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import { useSession } from '../../../lib/auth';
import { amountToGrams, canonicalAmount, perKgPrice, typedAmountError } from '../../../lib/amount';
import { primaryImage } from '../../catalog/components/ProductParts';
import type { ProductType, PackSize, OrderFormData } from '../../../types/orders';
import ProductName from '../../../components/common/ProductName';
import { getSavedAddresses, saveAddress, type SavedAddress } from '../api/ordersApi';

const FIELD_IDS: Partial<Record<keyof OrderFormData, string>> = {
  product: 'product-faki',
  packSize: 'pack-size',
  quantity: 'quantity',
  fullName: 'full-name',
  phone: 'phone',
  address: 'address',
  pinCode: 'pin-code',
};

const TYPED_OPTION = '__typed';

/** Any amount from 100 g to 10 kg in 50 g steps, typed in g or kg; shows the per-kg price and the amount's price. */
function TypedAmountInput({ packSize, pricePerKg, onChange }: {
  packSize: string; pricePerKg: number; onChange: (packSize: string) => void;
}) {
  const startGrams = amountToGrams(packSize) ?? 1000;
  const [unit, setUnit] = useState<'g' | 'kg'>(startGrams >= 1000 ? 'kg' : 'g');
  const [text, setText] = useState(String(startGrams >= 1000 ? startGrams / 1000 : startGrams));
  const error = typedAmountError(packSize);
  const grams = amountToGrams(packSize);

  function update(nextText: string, nextUnit: 'g' | 'kg') {
    setText(nextText);
    setUnit(nextUnit);
    const value = Number(nextText.replace(',', '.'));
    const typed = Number.isFinite(value) && value > 0 ? Math.round(value * (nextUnit === 'kg' ? 1000 : 1)) : 0;
    onChange(canonicalAmount(typed));
  }

  return (
    <div style={{ marginTop: 12 }}>
      <label htmlFor="typed-amount">Your amount</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="typed-amount"
          className="input"
          inputMode="decimal"
          value={text}
          onChange={(e) => update(e.target.value, unit)}
          aria-invalid={Boolean(error)}
          aria-describedby="typed-amount-hint"
        />
        <select className="input" style={{ width: 'auto' }} aria-label="Unit" value={unit}
          onChange={(e) => update(text, e.target.value as 'g' | 'kg')}>
          <option value="g">g</option>
          <option value="kg">kg</option>
        </select>
      </div>
      <p id="typed-amount-hint" className={error ? 'field-error' : 'text-small text-secondary'}>
        {error ?? `${formatINR(pricePerKg)} per kg · ${formatPackSize(packSize)} = ${formatINR(perKgPrice(pricePerKg, grams ?? 0))}`}
      </p>
    </div>
  );
}

export default function OrderFormPage() {
  const state = useOrder();
  const dispatch = useOrderDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [submitted, setSubmitted] = useState(false);
  const { session } = useSession();
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressMode, setAddressMode] = useState<'selected' | 'choose' | 'new'>('new');
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressError, setAddressError] = useState('');
  const addressDraft = useRef({ address: state.address, pinCode: state.pinCode });
  const addressTouched = useRef(false);
  addressDraft.current = { address: state.address, pinCode: state.pinCode };

  useEffect(() => {
    let active = true;
    if (!session) { setSavedAddresses([]); setAddressMode('new'); return; }
    setAddressLoading(true);
    getSavedAddresses().then((items) => {
      if (!active) return;
      setSavedAddresses(items);
      const current = addressDraft.current;
      if (addressTouched.current) return;
      if (!state.orderId && !current.address.trim() && !current.pinCode && items.length) {
        dispatch({ type: 'SET_ADDRESS', payload: items[0] });
        setAddressMode('selected');
      } else if (items.some((item) => item.address === current.address && item.pinCode === current.pinCode)) {
        setAddressMode('selected');
      }
      if (location.hash === '#delivery-address' && items.length) setAddressMode('choose');
    }).catch((error) => {
      if (active) setAddressError(getErrorMessage(error));
    }).finally(() => { if (active) setAddressLoading(false); });
    return () => { active = false; };
  }, [session?.user.id]);

  useEffect(() => {
    if (location.hash === '#delivery-address') {
      document.getElementById('delivery-address')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [location.hash]);

  function chooseAddress(address: SavedAddress) {
    addressTouched.current = true;
    dispatch({ type: 'SET_ADDRESS', payload: address });
    setAddressMode('selected');
    setAddressError('');
  }

  async function handleSaveAddress() {
    const address = state.address.trim();
    if (address.length < 10 || address.length > 500 || !/^[1-9][0-9]{5}$/.test(state.pinCode)) {
      setAddressError('Enter a complete address and valid 6-digit PIN code.');
      return;
    }
    setAddressSaving(true);
    setAddressError('');
    try {
      const saved = await saveAddress({ address, pinCode: state.pinCode });
      setSavedAddresses((current) => [saved, ...current.filter((item) => item.address !== saved.address || item.pinCode !== saved.pinCode)]);
      chooseAddress(saved);
    } catch (error) {
      setAddressError(getErrorMessage(error));
    } finally {
      setAddressSaving(false);
    }
  }

  // Preselect product from URL query param (?product=faki or ?product=supari)
  useEffect(() => {
    const p = searchParams.get('product');
    if (!p || !state.products.length) return;
    if (p !== state.product && state.products.some((item) => item.type === p)) {
      dispatch({ type: 'SET_PRODUCT', payload: p });
    }
    if (p) {
      const remaining = new URLSearchParams(searchParams);
      remaining.delete('product');
      setSearchParams(remaining, { replace: true });
    }
  }, [searchParams, dispatch, setSearchParams, state.products, state.product]);

  const summary = buildSummary(state);
  const pendingAmount = state.quoteError || state.catalogError ? 'Unavailable' : 'Pending quote';
  const currentProduct = state.products.find((p) => p.type === state.product);
  const canReview = Boolean(currentProduct && (state.customAmount
    ? currentProduct.pricePerKg != null && !typedAmountError(state.packSize)
    : currentProduct.prices[state.packSize] != null && currentProduct.inStock?.[state.packSize] !== false && currentProduct.priceConfirmed?.[state.packSize] !== false));
  const products = state.products;
  const errors = submitted ? validateForm(state) : {};
  const errorCount = Object.keys(errors).length;

  function handleReview() {
    if (!canReview) return;
    setSubmitted(true);
    const found = validateForm(state);
    const firstInvalid = (Object.keys(FIELD_IDS) as Array<keyof OrderFormData>).find(
      (k) => found[k],
    );
    if (firstInvalid) {
      document.getElementById(FIELD_IDS[firstInvalid]!)?.focus();
      return;
    }
    if (Object.keys(found).length) return;
    navigate('/order/review');
  }

  /** Shared a11y/error props for a text field. */
  function fieldProps(field: keyof OrderFormData) {
    const msg = errors[field];
    return {
      className: `input${msg ? ' input--error' : ''}`,
      'aria-invalid': msg ? true : undefined,
      'aria-describedby': msg ? `${FIELD_IDS[field]}-error` : undefined,
    };
  }

  function fieldError(field: keyof OrderFormData) {
    const msg = errors[field];
    if (!msg) return null;
    return (
      <p className="field-error" id={`${FIELD_IDS[field]}-error`}>
        {msg}
      </p>
    );
  }

  return (
    <div className="wrapper">
      <OrderStepper currentStep={1} />

      <h1 className="page__header">Place your order</h1>
      <p className="page__subtitle">Fill in your details — it takes about a minute.</p>

      {state.orderId && ['PENDING_PAYMENT', 'PAYMENT_REVIEW'].includes(state.serverOrder?.status ?? 'PENDING_PAYMENT') && (
        <Notice tone="info" title="Your existing order is saved" actions={<Link className="btn btn--primary btn--sm" to={`/my-orders/${encodeURIComponent(state.orderId)}`}>Continue existing order</Link>}>
          Open order {state.orderNumber || 'details'} to check payment or upload a new screenshot. You do not need to place this order again.
        </Notice>
      )}

      {errorCount > 0 && (
        <Notice tone="error" title="Please fix the highlighted fields" id="form-errors">
          {errorCount === 1 ? '1 field needs attention.' : `${errorCount} fields need attention.`}
        </Notice>
      )}

      <div className="two-col">
        {/* ---- Main form ---- */}
        <div className="two-col__main">
          <form className="card order-form" noValidate onSubmit={(e) => { e.preventDefault(); handleReview(); }}>
            {/* Section 1: Choose product */}
            <fieldset>
              <legend>1. Choose product</legend>

              {products.map((prod) => {
                const image = primaryImage(prod);
                return (
                <label
                  key={prod.type}
                  className={`radio-option${state.product === prod.type ? ' radio-option--selected' : ''}`}
                  style={{ marginBottom: 24 }}
                >
                  <input
                    id={`product-${prod.type}`}
                    type="radio"
                    name="product"
                    value={prod.type}
                    checked={state.product === prod.type}
                    onChange={() => dispatch({ type: 'SET_PRODUCT', payload: prod.type })}
                  />
                  {image && <img className="product-thumb" src={image.url} alt="" loading="lazy" decoding="async" />}
                  <ProductName name={prod.name} nameGu={prod.nameGu} />
                </label>
                );
              })}

              <div className="form-row" style={{ marginTop: 16 }}>
                <div>
                  <label htmlFor="pack-size">Pack size</label>
                  <select
                    id="pack-size"
                    className="input"
                    value={state.customAmount ? TYPED_OPTION : state.packSize}
                    onChange={(e) =>
                      e.target.value === TYPED_OPTION
                        ? dispatch({ type: 'SET_CUSTOM_AMOUNT', payload: '1kg' })
                        : dispatch({ type: 'SET_PACK_SIZE', payload: e.target.value as PackSize })
                    }
                  >
                    {(currentProduct?.packSizes ?? []).map((sz) => (
                      <option key={sz} value={sz} disabled={currentProduct?.prices[sz] == null || currentProduct?.inStock?.[sz] === false || currentProduct?.priceConfirmed?.[sz] === false}>
                        {formatPackSize(sz)}{currentProduct?.inStock?.[sz] === false ? ' (out of stock)' : currentProduct?.priceConfirmed?.[sz] === false ? ' (awaiting approval)' : ''}
                      </option>
                    ))}
                    {currentProduct?.pricePerKg != null && <option value={TYPED_OPTION}>Other amount (type your own)</option>}
                  </select>
                  {state.customAmount && currentProduct?.pricePerKg != null && (
                    <TypedAmountInput
                      key={state.product}
                      packSize={state.packSize}
                      pricePerKg={currentProduct.pricePerKg}
                      onChange={(packSize) => dispatch({ type: 'SET_CUSTOM_AMOUNT', payload: packSize })}
                    />
                  )}
                </div>
                <div>
                  <label id="quantity-label">Quantity</label>
                  <div className="quantity-control" role="group" aria-labelledby="quantity-label">
                    <button
                      type="button"
                      className="btn"
                      aria-label="Decrease quantity"
                      disabled={state.quantity <= 1}
                      onClick={() => dispatch({ type: 'SET_QUANTITY', payload: state.quantity - 1 })}
                    >
                      –
                    </button>
                    <input
                      id="quantity"
                      type="text"
                      className="quantity-control__value"
                      value={state.quantity}
                      readOnly
                      aria-label="Quantity"
                      aria-live="polite"
                    />
                    <button
                      type="button"
                      className="btn"
                      aria-label="Increase quantity"
                      disabled={state.quantity >= MAX_QUANTITY}
                      onClick={() => dispatch({ type: 'SET_QUANTITY', payload: state.quantity + 1 })}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </fieldset>

            {/* Section 2: Your details */}
            <fieldset>
              <legend>2. Your details</legend>

              <div className="form-row">
                <div>
                  <label htmlFor="full-name">Full name</label>
                  <input
                    id="full-name"
                    {...fieldProps('fullName')}
                    type="text"
                    autoComplete="name"
                    maxLength={100}
                    placeholder="e.g. Rahul Mehta"
                    value={state.fullName}
                    onChange={(e) =>
                      dispatch({ type: 'SET_FIELD', payload: { field: 'fullName', value: e.target.value } })
                    }
                  />
                  {fieldError('fullName')}
                </div>
                <div>
                  <label htmlFor="phone">Mobile number (+91)</label>
                  <MobileNumberInput
                    id="phone"
                    {...fieldProps('phone')}
                    value={state.phone}
                    onChange={(phone) =>
                      dispatch({
                        type: 'SET_FIELD',
                        payload: { field: 'phone', value: phone },
                      })
                    }
                  />
                  {fieldError('phone')}
                </div>
              </div>

              <div id="delivery-address" className="address-picker">
                <div className="detail-header">
                  <h3>Delivery address</h3>
                  {addressMode === 'selected' && <button type="button" className="text-button" onClick={() => setAddressMode('choose')}>Change address</button>}
                </div>
                {addressLoading && <p className="text-small text-secondary" role="status">Loading saved addresses…</p>}
                {addressError && <Notice tone="error" title="Address unavailable">{addressError}</Notice>}
                {addressMode === 'selected' && (
                  <div className="address-picker__selected">
                    <strong>Deliver here</strong>
                    <p>{state.address} – {state.pinCode}</p>
                  </div>
                )}
                {addressMode === 'choose' && (
                  <div className="address-picker__choices">
                    {savedAddresses.map((item, index) => (
                      <button key={`${item.address}:${item.pinCode}`} type="button" className="address-picker__choice" onClick={() => chooseAddress(item)}>
                        <span className="address-picker__choice-title">{index === 0 ? 'Recent address' : `Saved address ${index + 1}`}</span>
                        <span>{item.address} – {item.pinCode}</span>
                        <span className="text-small">Deliver here</span>
                      </button>
                    ))}
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => { addressTouched.current = true; setAddressMode('new'); setAddressError(''); dispatch({ type: 'SET_ADDRESS', payload: { address: '', pinCode: '' } }); }}>+ Add a new address</button>
                  </div>
                )}
                {addressMode === 'new' && (
                  <div>
                    {savedAddresses.length > 0 && <button type="button" className="text-button" disabled={addressSaving} onClick={() => { setAddressMode('choose'); setAddressError(''); }}>Choose a saved address</button>}
                    <div style={{ marginBottom: 16 }}>
                      <label htmlFor="address">Street address</label>
                      <textarea id="address" {...fieldProps('address')} autoComplete="street-address" maxLength={500} disabled={addressSaving}
                        placeholder="House no., society, area, city" value={state.address}
                        onChange={(e) => { addressTouched.current = true; dispatch({ type: 'SET_FIELD', payload: { field: 'address', value: e.target.value } }); }} />
                      {fieldError('address')}
                    </div>
                    <div style={{ maxWidth: 240 }}>
                      <label htmlFor="pin-code">PIN code</label>
                      <input id="pin-code" {...fieldProps('pinCode')} type="text" inputMode="numeric" disabled={addressSaving}
                        autoComplete="postal-code" maxLength={6} placeholder="6-digit PIN" value={state.pinCode}
                        onChange={(e) => { addressTouched.current = true; dispatch({ type: 'SET_FIELD', payload: { field: 'pinCode', value: e.target.value.replace(/\D/g, '').slice(0, 6) } }); }} />
                      {fieldError('pinCode')}
                    </div>
                    {session && <button type="button" className="btn btn--outline btn--sm" disabled={addressSaving} onClick={() => void handleSaveAddress()}>
                      {addressSaving ? 'Saving address…' : 'Save address'}
                    </button>}
                  </div>
                )}
              </div>
            </fieldset>
            {/* Hidden submit so Enter in a field triggers review */}
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        </div>

        {/* ---- Sidebar: Order summary ---- */}
        <div className="two-col__side">
          <div className="card card--tinted" id="order-summary">
            <h2 className="summary-heading">Order summary</h2>

            <div className="summary-row">
              <span>
                <ProductName name={summary.productName} nameGu={summary.productNameGu} /> · {formatPackSize(summary.packSize)} × {summary.quantity}
              </span>
              <strong>{formatINR(summary.subtotal)}</strong>
            </div>
            <div className="summary-row">
              <span>Delivery</span>
              <strong>{summary.deliveryFee === null ? pendingAmount : formatINR(summary.deliveryFee)}</strong>
            </div>
            <div className="summary-row" >
              <span>Total</span>
              <strong>{summary.total === null ? pendingAmount : formatINR(summary.total)}</strong>
            </div>

            {state.catalogStatus && <p className="text-small text-secondary catalog-status" role="status">{state.catalogStatus}</p>}
            {state.catalogError && <Notice tone="error" title="Cannot load products and prices">
              {state.catalogError} <button type="button" className="btn btn--sm" onClick={() => dispatch({ type: 'RETRY_CATALOG' })}>Try again</button>
            </Notice>}
            {state.quoteStatus && <p className="text-small text-secondary catalog-status" role="status">{state.quoteStatus}</p>}
            {state.quoteError && <Notice tone="error" title="Cannot calculate checkout total">
              {state.quoteError} <button type="button" className="btn btn--sm" onClick={() => dispatch({ type: 'RETRY_CATALOG' })}>Try again</button>
            </Notice>}
            <button
              type="button"
              disabled={!canReview}
              className="btn btn--primary btn--full"
              id="review-order-btn"
              onClick={handleReview}
            >
              Review Order →
            </button>

            <p className="text-secondary text-small" style={{ marginTop: 12 }}>
              You won't pay yet — payment comes after review.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
