import { Link } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { formatDateTime } from '../lib/formatDateTime';
import { PAYMENT_STATUS_LABELS } from '../lib/orderStateMachine';
import type { DuplicateScreenshotInfo } from '../types';

/**
 * Information for the admin: the identical image file (same SHA-256) was uploaded before.
 * It is never a verdict: approving or rejecting works exactly as without it.
 */
export default function DuplicateScreenshotNotice({
  info,
  onOpenPayment,
}: {
  info?: DuplicateScreenshotInfo;
  onOpenPayment?: (paymentId: string) => void;
}) {
  if (!info || info.count === 0) return null;
  const hidden = info.count - info.matches.length;
  return (
    <Notice tone="warning" title="Possible duplicate screenshot">
      <p>This exact image file was uploaded before:</p>
      <ul className="duplicate-screenshot-list" style={{ margin: '6px 0 8px', paddingLeft: 18 }}>
        {info.matches.map((match) => (
          <li key={match.paymentId}>
            {match.sameOrder ? 'Sent earlier for this same order' : 'Also uploaded for another order'}:{' '}
            <strong>{match.orderNumber}</strong> · payment {PAYMENT_STATUS_LABELS[match.paymentStatus]?.toLowerCase() ?? match.paymentStatus} ·{' '}
            {formatDateTime(match.submittedAt)}{' '}
            {onOpenPayment && (
              <button type="button" className="text-button" onClick={() => onOpenPayment(match.paymentId)}>
                Open payment
              </button>
            )}
            {!match.sameOrder && (
              <>
                {onOpenPayment ? ' · ' : ' '}
                <Link to={`/admin/orders?q=${encodeURIComponent(match.orderNumber)}`}>View order</Link>
              </>
            )}
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="text-small">{hidden} more match{hidden === 1 ? '' : 'es'} not shown.</p>}
      <p className="text-small text-secondary">
        A file match is only information. It does not mean this payment is wrong or that anyone did something wrong, so
        check the amount, the receiver and the date as usual. Only identical files are found; cropped, edited or re-saved
        images are not.
      </p>
    </Notice>
  );
}
