/**
 * Brief Upload Component
 * 
 * Handles PDF upload and text extraction for both user and opposing briefs.
 * Uses shared UI components for consistent styling.
 */

import { useCallback, useEffect, useState } from 'react';
import type { BriefData } from '../types';
import { extractPdfText } from '../../features/pdf/utils/extractPdfText';
import { Button, Alert, Card, CardHeader, CardContent, FileUpload } from './ui';

interface BriefUploadProps {
  onBriefsReady: (userBrief: BriefData, opposingBrief: BriefData) => void;
  /** Increment to reset the Start button (e.g. when Clear Session is clicked) */
  clearTrigger?: number;
}

function countWords(text: string): number {
  return text.split(/\s+/).length;
}

export function BriefUpload({ onBriefsReady, clearTrigger }: BriefUploadProps) {
  const [userBrief, setUserBrief] = useState<BriefData | null>(null);
  const [opposingBrief, setOpposingBrief] = useState<BriefData | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userBrief || !opposingBrief) setStarted(false);
  }, [userBrief, opposingBrief]);

  useEffect(() => {
    if (clearTrigger != null && clearTrigger > 0) setStarted(false);
  }, [clearTrigger]);

  const handleFileUpload = useCallback(async (file: File, type: 'user' | 'opposing') => {
    try {
      setError(null);
      const text = await extractPdfText(file);
      const briefData: BriefData = { name: file.name, text };
      
      if (type === 'user') {
        setUserBrief(briefData);
      } else {
        setOpposingBrief(briefData);
      }
    } catch (err) {
      console.error('Failed to extract PDF text:', err);
      setError('Failed to read PDF. Please try a different file.');
    }
  }, []);

  const handleStart = useCallback(async () => {
    if (!userBrief || !opposingBrief) return;
    setStarted(true);
    onBriefsReady(userBrief, opposingBrief);
  }, [userBrief, opposingBrief, onBriefsReady]);

  const canStart = userBrief && opposingBrief && !started;

  return (
    <Card>
      <CardHeader>Upload Briefs</CardHeader>
      <CardContent>
        {error && <Alert variant="error">{error}</Alert>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <FileUpload
            label="Your Brief"
            file={userBrief ? { 
              name: userBrief.name, 
              wordCount: countWords(userBrief.text) 
            } : null}
            onFileSelect={(file) => handleFileUpload(file, 'user')}
            onRemove={() => setUserBrief(null)}
          />

          <FileUpload
            label="Opposing Counsel's Brief"
            file={opposingBrief ? { 
              name: opposingBrief.name, 
              wordCount: countWords(opposingBrief.text) 
            } : null}
            onFileSelect={(file) => handleFileUpload(file, 'opposing')}
            onRemove={() => setOpposingBrief(null)}
          />
        </div>

        {canStart && (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleStart}
          >
            Start
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
