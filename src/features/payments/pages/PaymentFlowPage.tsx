import { Link } from 'react-router-dom';

const steps = [
  { title: 'Customer Details', description: 'Faki / Supari, quantity, name, phone, address.', label: 'Order Form', route: '/order' },
  { title: 'Review Order', description: 'Check items, server totals and delivery details before payment.', label: 'Review Order', route: '/order/review' },
  { title: 'QR Payment', description: 'Scan the official UPI QR, pay and submit the UTR and screenshot.', label: 'QR Payment', route: '/order/payment' },
  { title: 'Payment Verification', description: 'Our team checks the bank credit. Your payment stays pending until verified.', label: 'Verification', route: '/order/verification' },
  { title: 'Order Active', description: 'Once the server confirms the order, you can track delivery.', label: 'My Orders', route: '/my-orders' },
];

export default function PaymentFlowPage() {
  return <div className="wrapper section">
    <h1 className="page__header">Payment flow</h1>
    <p className="page__subtitle">From customer details to an active order.</p>
    <ol className="payment-flow-grid">{steps.map((step, index) => <li className="card" key={step.title}>
      <span className="step-card__number">{index + 1}</span><h3>{step.title}</h3>
      <p className="text-secondary">{step.description}</p><Link className="badge" to={step.route}>{step.label}</Link>
    </li>)}</ol>
    <p className="card card--tinted">If a payment cannot be matched, contact the store with your UTR. Do not pay again until the store has checked the bank credit.</p>
  </div>;
}
