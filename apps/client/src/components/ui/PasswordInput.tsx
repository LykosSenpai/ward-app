import { useState } from "react";
import type { InputHTMLAttributes } from "react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> & {
  onChange: (value: string) => void;
};

export function PasswordInput({ className, disabled, onChange, ...inputProps }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);
  const visibilityLabel = isVisible ? "Hide password" : "Show password";

  return (
    <span className="password-input-wrap">
      <input
        {...inputProps}
        className={className}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        type={isVisible ? "text" : "password"}
      />
      <button
        aria-label={visibilityLabel}
        className="password-visibility-button"
        disabled={disabled}
        onClick={() => setIsVisible(current => !current)}
        title={visibilityLabel}
        type="button"
      >
        {isVisible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24">
      <path
        d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24">
      <path
        d="m3 3 18 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M10.6 5.1c.5-.1.9-.1 1.4-.1 6.1 0 9.5 7 9.5 7a17.4 17.4 0 0 1-3.1 3.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M14.1 14.1A3 3 0 0 1 9.9 9.9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M7.4 7.4C4.2 9.1 2.5 12 2.5 12S5.9 19 12 19c1.7 0 3.2-.4 4.5-1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
