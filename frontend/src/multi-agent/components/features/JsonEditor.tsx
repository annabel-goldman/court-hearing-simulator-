/**
 * JSON Editor Component
 * 
 * Textarea for editing agent JSON with validation
 * 
 * Styles: styles/input.css
 */

import { TextArea } from '../ui';

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  height?: string;
}

export function JsonEditor({ 
  value, 
  onChange, 
  error,
  height = '20rem' 
}: JsonEditorProps) {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  return (
    <TextArea
      label="Agent JSON"
      value={value}
      onChange={handleChange}
      error={error || undefined}
      monospace
      style={{ height }}
      spellCheck={false}
    />
  );
}
