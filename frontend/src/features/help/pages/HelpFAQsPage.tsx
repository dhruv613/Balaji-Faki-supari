import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FAQItem } from '../../../types/orders';
import { env } from '../../../lib/env';

const FAQS: FAQItem[] = [
  {
    question: 'How do I pay for my order?',
    answer: 'After you review your order, scan the UPI QR with any UPI app and pay the exact amount shown.',
  },
  {
    question: 'What happens after I pay?',
    answer: 'Submit your UTR and payment screenshot. Our team checks the bank credit before payment is verified and the order is confirmed.',
  },
  {
    question: 'My payment is still pending.',
    answer: 'Our team manually checks the bank credit before confirming payment. Please do not pay again. Use Refresh status or contact the store if you need help.',
  },
  {
    question: 'How do I track my order?',
    answer: 'Go to "My Orders" and open the order details to see its latest status and completed updates.',
  },
  {
    question: 'Can I change my address?',
    answer: 'You can edit your address on the order form before you pay. After payment, contact us on WhatsApp to request an address change.',
  },
  {
    question: 'Can I visit the store?',
    answer: 'Yes — see Visit Store for the address and call to confirm opening hours.',
  },
];

export default function HelpFAQsPage() {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const filtered = FAQS.filter(faq => `${faq.question} ${faq.answer}`.toLocaleLowerCase().includes(query));
  return (
    <div className="wrapper help-page">
      <h1 className="page__header">Help &amp; FAQs</h1>

      <div className="two-col">
        {/* FAQ list */}
        <div className="two-col__main">
          {/* Search */}
          <div style={{ marginBottom: 24 }}>
            <label htmlFor="help-search" className="text-small" style={{ fontWeight: 600 }}>
              Search help
            </label>
            <input
              id="help-search"
              className="input"
              type="text"
              placeholder="Search help topics"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>

          {filtered.length === 0 && <p role="status" className="text-secondary">No matching help topics. Try another search or contact the store.</p>}
          {filtered.map((faq, i) => (
            <details className="faq-item" key={faq.question} open={query ? true : i === 0}>
              <summary className="faq-summary">
                {faq.question}
                <svg
                  className="icon icon-chevron"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </summary>
              <div className="faq-answer">
                <p>{faq.answer}</p>{faq.question === 'How do I pay for my order?' && <Link to="/payment-flow">See the payment flow</Link>}
              </div>
            </details>
          ))}
        </div>

        {/* Contact sidebar */}
        <div className="two-col__side">
          <div className="contact-sidebar">
            <h3>Still need help?</h3>
            <p className="contact-sidebar__subtitle">Talk to us directly.</p>

            <a
              href="tel:+918000961030"
              className="btn btn--primary btn--full"
            >
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>
              Call +91 80009 61030
            </a>

            <a
              href={`https://wa.me/${env.supportWhatsApp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--full"
              style={{ marginTop: 8 }}
            >
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
              WhatsApp us
            </a>

            <Link
              to="/store"
              className="btn btn--full"
              style={{ marginTop: 8 }}
            >
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
              Visit store
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
