import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { formatINR, formatPackSize } from '../../../lib/api';
import { primaryImage } from '../../catalog/components/ProductParts';
import type { ProductType, PackSize, OrderFormData } from '../../../types/orders';

const FIELD_IDS: Partial<Record<keyof OrderFormData, string>> = {
  product: 'product-faki',
  packSize: 'pack-size',
  quantity: 'quantity',
  fullName: 'full-name',
  phone: 'phone',
  address: 'address',
  pinCode: 'pin-code',
};

export default function OrderFormPage() {
  const state = useOrder();
  const dispatch = useOrderDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [submitted, setSubmitted] = useState(false);

  // Preselect product from URL query param (?product=faki or ?product=supari)
  useEffect(() => {
    const p = searchParams.get('product');
    if (p && (p === 'faki' || p === 'supari') && p !== state.product) {
      dispatch({ type: 'SET_PRODUCT', payload: p });
    }
    if (p) {
      const remaining = new URLSearchParams(searchParams);
      remaining.delete('product');
      setSearchParams(remaining, { replace: true });
    }
  }, [searchParams, dispatch, setSearchParams]);

  const summary = buildSummary(state);
  const currentProduct = state.products.find((p) => p.type === state.product);
  const products = state.products;
  const errors = submitted ? validateForm(state) : {};
  const errorCount = Object.keys(errors).length;

  function handleReview() {
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
                  {prod.name}
                </label>
                );
              })}

              <div className="form-row" style={{ marginTop: 16 }}>
                <div>
                  <label htmlFor="pack-size">Pack size</label>
                  <select
                    id="pack-size"
                    className="input"
                    value={state.packSize}
                    onChange={(e) =>
                      dispatch({ type: 'SET_PACK_SIZE', payload: e.target.value as PackSize })
                    }
                  >
                    {(currentProduct?.packSizes ?? []).map((sz) => (
                      <option key={sz} value={sz}>{formatPackSize(sz)}</option>
                    ))}
                  </select>
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

              <div style={{ marginBottom: 16 }}>
                <label htmlFor="address">Delivery address</label>
                <textarea
                  id="address"
                  {...fieldProps('address')}
                  autoComplete="street-address"
                  placeholder="House no., society, area, city"
                  value={state.address}
                  onChange={(e) =>
                    dispatch({ type: 'SET_FIELD', payload: { field: 'address', value: e.target.value } })
                  }
                />
                {fieldError('address')}
              </div>

              <div style={{ maxWidth: 240 }}>
                <label htmlFor="pin-code">PIN code</label>
                <input
                  id="pin-code"
                  {...fieldProps('pinCode')}
                  type="text"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={6}
                  placeholder="6-digit PIN"
                  value={state.pinCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    dispatch({ type: 'SET_FIELD', payload: { field: 'pinCode', value: val } });
                  }}
                />
                {fieldError('pinCode')}
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
                {summary.productName} · {formatPackSize(summary.packSize)} × {summary.quantity}
              </span>
              <strong>{formatINR(summary.subtotal)}</strong>
            </div>
            <div className="summary-row">
              <span>Delivery</span>
              <strong>{formatINR(summary.deliveryFee)}</strong>
            </div>
            <div className="summary-row" >
              <span>Total</span>
              <strong>{formatINR(summary.total)}</strong>
            </div>

            {state.catalogStatus && <p className="text-small text-secondary catalog-status" role="status">{state.catalogStatus}</p>}
            {state.quoteStatus && <p className="text-small text-secondary catalog-status" role="status">{state.quoteStatus}</p>}
            <button
              type="button"
              disabled={!currentProduct}
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
