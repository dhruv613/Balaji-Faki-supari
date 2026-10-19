import { Link } from 'react-router-dom';
import { contactDetails, useStoreProfile } from '../../features/store/storeApi';

export default function Footer() {
  const { profile } = useStoreProfile();
  const contact = contactDetails(profile);
  return (
    <footer className="footer" id="site-footer">
      <div className="wrapper">
        {/* Logo */}
        <Link to="/" className="footer__logo" aria-label="Balaji Faki Point">
          <img src="/images/balaji-logo.png" width="62" height="32" alt="Balaji Faki Point" />
        </Link>

        {/* Store info */}
        <div className="footer__info">
          {profile?.storeAddress && <p>{profile.storeAddress}</p>}
          {contact.phoneDisplay && <p>Call / WhatsApp: {contact.phoneDisplay}</p>}
        </div>

        {/* Copyright */}
        <span className="footer__copy">© 2026 Balaji Faki Point</span>
      </div>
    </footer>
  );
}
