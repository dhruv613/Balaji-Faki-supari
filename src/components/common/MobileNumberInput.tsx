import type { InputHTMLAttributes } from 'react';
import { normalizeIndianMobile } from '../../lib/customer';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'maxLength'> & {
  value: string;
  onChange: (value: string) => void;
};

export default function MobileNumberInput({ value, onChange, className = 'input', ...props }: Props) {
  return <div className="mobile-input">
    <span aria-hidden="true">+91</span>
    <input {...props} className={className} type="tel" inputMode="numeric" autoComplete="tel-national"
      maxLength={10} pattern="[6-9][0-9]{9}" placeholder="9876543210" value={value}
      onChange={event => {
        event.currentTarget.setCustomValidity('');
        onChange(event.target.value.replace(/\D/g, '').slice(0, 10));
      }}
      onPaste={event => {
        event.preventDefault();
        const digits = normalizeIndianMobile(event.clipboardData.getData('text'));
        const acceptable = /^\d{1,10}$/.test(digits);
        event.currentTarget.setCustomValidity(acceptable ? '' : 'Enter a maximum of 10 digits, excluding +91.');
        if (acceptable) onChange(digits);
        else event.currentTarget.reportValidity();
      }} />
  </div>;
}
