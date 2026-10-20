import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { env } from '@shared/lib/env';

/** Link to the customer storefront, which is a separate site; hidden when its address is not configured. */
export default function StoreLink({ className, style, onClick, children }: {
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLElement>;
  children: ReactNode;
}) {
  return env.storeUrl ? <a href={env.storeUrl} className={className} style={style} onClick={onClick}>{children}</a> : null;
}
