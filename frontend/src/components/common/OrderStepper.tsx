/**
 * Order flow stepper: Details → Review → Pay by QR → Verify → Active
 */

interface StepperProps {
  /** 1-based index of the current step (1–5) */
  currentStep: number;
}

const STEPS = ['Details', 'Review', 'Pay by QR', 'Verify', 'Active'];

export default function OrderStepper({ currentStep }: StepperProps) {
  return (
    <ol className="stepper" aria-label="Order progress">
      {STEPS.map((label, i) => {
        const stepNum = i + 1;
        let className = 'stepper__item';
        if (stepNum < currentStep) className += ' stepper__item--done';
        else if (stepNum === currentStep) className += ' stepper__item--current';

        return (
          <li key={label} className={className} aria-current={stepNum === currentStep ? 'step' : undefined}>
            <span className="stepper__circle" aria-hidden="true">
              {stepNum < currentStep ? (
                <CheckIcon />
              ) : (
                stepNum
              )}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CheckIcon() {
  return (
    <svg
      className="icon icon--sm"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
