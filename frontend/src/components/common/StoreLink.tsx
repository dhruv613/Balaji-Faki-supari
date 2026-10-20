import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { env } from '../../lib/env';

/** Link to the customer storefront: in-app in a combined build, the storefront's own address in an admin-only build. */
export default function StoreLink({ className, style, onClick, children }: {
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLElement>;
  children: ReactNode;
}) {
  if (env.appMode === 'admin') {
    return env.storeUrl ? <a href={env.storeUrl} className={className} style={style} onClick={onClick}>{children}</a> : null;
  }
  return <Link to="/" className={className} style={style} onClick={onClick}>{children}</Link>;
}
