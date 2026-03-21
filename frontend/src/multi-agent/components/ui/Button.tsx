/**
 * Reusable Button Component
 * 
 * Variants: primary, secondary, success, danger, warning, ghost
 * Sizes: sm, md, lg
 * 
 * Styles: styles/button.css
 */

import '../../styles/button.css';

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const classes = [
    'ma-btn',
    `ma-btn--${variant}`,
    `ma-btn--${size}`,
    fullWidth ? 'ma-btn--full' : '',
    className,
  ].filter(Boolean).join(' ');
  
  return (
    <button
      className={classes}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="ma-btn__loading">
          <span className="ma-btn__spinner" />
          Loading...
        </span>
      ) : (
        children
      )}
    </button>
  );
}
