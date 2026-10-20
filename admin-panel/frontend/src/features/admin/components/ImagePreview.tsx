import { useState } from 'react';

export interface ImagePreviewProps {
  src?: string;
  alt: string;
  privateStoragePath?: string;
  caption?: string;
}

/**
 * Secure Image & Private Payment Screenshot Viewer.
 * Never exposes public URLs for private payment proofs — requires short-lived
 * signed URLs issued by FastAPI for private bucket objects.
 */
export default function ImagePreview({
  src,
  alt,
  privateStoragePath,
  caption,
}: ImagePreviewProps) {
  const [expanded, setExpanded] = useState(false);

  if (!src) {
    return (
      <div
        className="card card--tinted"
        style={{ padding: 16, textAlign: 'center', fontSize: 14 }}
      >
        <p style={{ fontWeight: 600 }}>Private Supabase Storage Object</p>
        {privateStoragePath && (
          <p className="text-small text-secondary" style={{ marginTop: 4, wordBreak: 'break-all' }}>
            Bucket path: <code>{privateStoragePath}</code>
          </p>
        )}
        <p className="text-small text-secondary" style={{ marginTop: 6 }}>
          Public payment-proof URLs are never exposed. FastAPI issues a short-lived signed URL after verifying Owner Admin role.
        </p>
      </div>
    );
  }

  return (
    <>
      <div>
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => setExpanded(true)}
        >
          View full image
        </button>
        <img
          src={src}
          alt={alt}
          className="screenshot-preview"
          style={{ cursor: 'pointer', maxHeight: 160, objectFit: 'cover' }}
          onClick={() => setExpanded(true)}
        />
        {caption && <p className="text-small text-secondary" style={{ marginTop: 4 }}>{caption}</p>}
      </div>

      {expanded && (
        <div
          className="admin-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setExpanded(false)}
        >
          <div className="admin-modal" style={{ textAlign: 'center', maxWidth: 680 }}>
            <div className="detail-header">
              <h3 style={{ fontSize: 20 }}>{alt}</h3>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setExpanded(false)}
              >
                Close preview
              </button>
            </div>
            <img
              src={src}
              alt={alt}
              style={{ maxWidth: '100%', maxHeight: '70vh', margin: '16px auto', borderRadius: 12 }}
            />
            {caption && <p className="text-small text-secondary">{caption}</p>}
          </div>
        </div>
      )}
    </>
  );
}
