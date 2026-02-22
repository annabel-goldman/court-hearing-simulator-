/**
 * Input Components
 * 
 * Styled form inputs: text input, textarea, color picker
 * 
 * Styles: styles/input.css
 */

import '../../styles/input.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  monospace?: boolean;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  const inputClasses = [
    'ma-input',
    error ? 'ma-input--error' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div>
      {label && <label className="ma-input__label">{label}</label>}
      <input className={inputClasses} {...props} />
      {error && <p className="ma-input__error">{error}</p>}
    </div>
  );
}

export function TextArea({ 
  label, 
  error, 
  monospace = false, 
  className = '', 
  ...props 
}: TextAreaProps) {
  const textareaClasses = [
    'ma-textarea',
    error ? 'ma-textarea--error' : '',
    monospace ? 'ma-textarea--mono' : '',
    className,
  ].filter(Boolean).join(' ');
  
  return (
    <div>
      {label && <label className="ma-textarea__label">{label}</label>}
      <textarea className={textareaClasses} {...props} />
      {error && <p className="ma-textarea__error">{error}</p>}
    </div>
  );
}

interface ColorPickerProps {
  label?: string;
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  return (
    <div>
      {label && <label className="ma-input__label">{label}</label>}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ma-color-picker"
      />
    </div>
  );
}
