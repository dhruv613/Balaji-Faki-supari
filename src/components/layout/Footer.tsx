import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer" id="site-footer">
      <div className="wrapper">
        {/* Logo */}
        <Link to="/" className="footer__logo" aria-label="Balaji Faki Point">
          <img src="/images/balaji-logo.png" width="62" height="32" alt="Balaji Faki Point" />
        </Link>

        {/* Store info */}
        <div className="footer__info">
          <p>Riddhi Siddhi Complex, University Rd.</p>
          <p>nr. Bhagat Singh Garden, Rajkot, Gujarat 360005</p>
          <p>Call / WhatsApp: +91 80009 61030</p>
        </div>

        {/* Copyright */}
        <span className="footer__copy">© 2026 Balaji Faki Point</span>
      </div>
    </footer>
  );
}
