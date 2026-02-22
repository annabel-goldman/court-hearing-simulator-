/**
 * File Upload Component
 * 
 * Drag-and-drop file upload zone with preview
 * 
 * Styles: styles/file-upload.css
 */

import { useState, DragEvent } from 'react';
import '../../styles/file-upload.css';

interface FileUploadProps {
  label: string;
  accept?: string;
  file: { name: string; wordCount?: number } | null;
  onFileSelect: (file: File) => void;
  onRemove: () => void;
  hint?: string;
}

export function FileUpload({ 
  label, 
  accept = '.pdf', 
  file, 
  onFileSelect, 
  onRemove,
  hint = 'PDF files only' 
}: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      onFileSelect(selectedFile);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      onFileSelect(files[0]);
    }
  };

  const zoneClasses = [
    'ma-file-upload__zone',
    isDragOver ? 'ma-file-upload__zone--dragover' : '',
    file ? 'ma-file-upload__zone--has-file' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="ma-file-upload">
      <label className="ma-file-upload__label">{label}</label>
      <div 
        className={zoneClasses}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {file ? (
          <FilePreview 
            name={file.name} 
            wordCount={file.wordCount} 
            onRemove={onRemove} 
          />
        ) : (
          <FileDropZone 
            accept={accept} 
            hint={hint} 
            onChange={handleChange}
            isDragOver={isDragOver}
          />
        )}
      </div>
    </div>
  );
}

interface FilePreviewProps {
  name: string;
  wordCount?: number;
  onRemove: () => void;
}

function FilePreview({ name, wordCount, onRemove }: FilePreviewProps) {
  return (
    <div className="ma-file-preview">
      <span className="ma-file-preview__name">{name}</span>
      {wordCount !== undefined && (
        <span className="ma-file-preview__meta">
          {wordCount.toLocaleString()} words
        </span>
      )}
      <button onClick={onRemove} className="ma-file-preview__remove">
        Remove
      </button>
    </div>
  );
}

interface FileDropZoneProps {
  accept: string;
  hint: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isDragOver: boolean;
}

function FileDropZone({ accept, hint, onChange, isDragOver }: FileDropZoneProps) {
  return (
    <label style={{ cursor: 'pointer', display: 'block' }}>
      <div className="ma-file-upload__text">
        {isDragOver ? (
          <span className="ma-file-upload__text--highlight">Drop file here</span>
        ) : (
          <>
            <span className="ma-file-upload__text--highlight">Click to upload</span> or drag and drop
          </>
        )}
      </div>
      <div className="ma-file-upload__hint">{hint}</div>
      <input
        type="file"
        accept={accept}
        onChange={onChange}
        className="ma-file-upload__input"
      />
    </label>
  );
}
