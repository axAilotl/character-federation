'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout';
import { Button, Badge } from '@/components/ui';
import type { ParseResultWithAssets } from '@/lib/client/card-parser';

// Dynamic imports to avoid SSR bundling issues
const getCardParser = () => import('@/lib/client/card-parser');
const getPresignedUpload = () => import('@/lib/client/presigned-upload');
const getChunkedUpload = () => import('@/lib/client/chunked-upload');

interface ParseState {
  status: 'idle' | 'parsing' | 'parsed' | 'error';
  result?: ParseResultWithAssets;
  error?: string;
}

type UploadStage = 'preparing' | 'presigning' | 'uploading' | 'confirming' | 'processing' | 'chunking' | null;
type CardVisibility = 'public' | 'private' | 'unlisted';

const VISIBILITY_OPTIONS: { value: CardVisibility; label: string; description: string }[] = [
  { value: 'public', label: 'Public', description: 'Visible to everyone, appears in search and browse' },
  { value: 'unlisted', label: 'Unlisted', description: 'Only accessible via direct link' },
  { value: 'private', label: 'Private', description: 'Only visible to you' },
];

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStage, setUploadStage] = useState<UploadStage>(null);
  const [error, setError] = useState<string | null>(null);
  const [parseState, setParseState] = useState<ParseState>({ status: 'idle' });
  const [visibility, setVisibility] = useState<CardVisibility>('public');
  // DISABLED: Presigned uploads are broken in multiple ways (wrong paths, no collection support, asset issues)
  // Force all uploads through FormData which actually works
  // TODO: Re-enable with proper large file support when fixed
  const [usePresigned] = useState<boolean>(false);
  const [currentUploadFile, setCurrentUploadFile] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFile(droppedFile);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFile(selectedFile);
    }
  };

  const handleFile = async (selectedFile: File) => {
    setError(null);
    setParseState({ status: 'idle' });

    // Validate file type
    const validExtensions = ['.png', '.json', '.charx', '.voxpkg'];
    const hasValidExtension = validExtensions.some(ext => selectedFile.name.toLowerCase().endsWith(ext));
    if (!hasValidExtension) {
      setError('Please upload a PNG, JSON, CharX, or Voxta character card file');
      return;
    }

    // No file size limit - large files use chunked upload
    // Show warning for very large files (>500MB)
    if (selectedFile.size > 500 * 1024 * 1024) {
      console.log(`Large file detected: ${(selectedFile.size / 1024 / 1024).toFixed(1)}MB - will use chunked upload`);
    }

    setFile(selectedFile);

    // Parse the card client-side
    setParseState({ status: 'parsing' });

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      // Parse card entirely client-side (dynamic import to avoid SSR bundling issues)
      const { parseFromBufferWithAssets } = await getCardParser();
      const result = parseFromBufferWithAssets(buffer, selectedFile.name);

      setParseState({ status: 'parsed', result });

      // Generate preview from main image if available
      if (result.mainImage) {
        const blob = new Blob([new Uint8Array(result.mainImage)], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        setPreview(url);
      } else if (selectedFile.name.endsWith('.png')) {
        // Use file directly for PNG preview
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreview(e.target?.result as string);
        };
        reader.readAsDataURL(selectedFile);
      } else {
        setPreview(null);
      }
    } catch (err) {
      setParseState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to parse card',
      });
      setError(err instanceof Error ? err.message : 'Failed to parse card');
    }
  };

  const handleUpload = async () => {
    if (!file || parseState.status !== 'parsed' || !parseState.result) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStage('preparing');
    setError(null);
    setCurrentUploadFile(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      // Compute content hash client-side (dynamic import)
      const { computeContentHash } = await getCardParser();
      const contentHash = await computeContentHash(buffer);

      // Check if we should use chunked upload for large files
      const { shouldUseChunkedUpload, uploadChunked } = await getChunkedUpload();

      // Use chunked upload for large single-character files (>=75MB)
      // Multi-char packages (Voxta collections) always use FormData for server-side handling
      if (shouldUseChunkedUpload(file.size) && !parseState.result.isMultiCharPackage) {
        setUploadStage('chunking');

        const result = await uploadChunked(
          file,
          parseState.result,
          visibility,
          contentHash,
          (progress) => {
            switch (progress.stage) {
              case 'creating':
                setUploadStage('preparing');
                setUploadProgress(progress.percent);
                break;
              case 'uploading':
                setUploadStage('chunking');
                setUploadProgress(progress.percent);
                setCurrentUploadFile(
                  progress.currentChunk && progress.totalChunks
                    ? `chunk ${progress.currentChunk}/${progress.totalChunks}`
                    : null
                );
                break;
              case 'completing':
                setUploadStage('confirming');
                setUploadProgress(progress.percent);
                break;
              case 'done':
                setUploadStage('processing');
                setUploadProgress(100);
                break;
              case 'error':
                throw new Error(progress.error || 'Upload failed');
            }
          }
        );

        if (result.success && result.slug) {
          router.push(`/card/${result.slug}`);
        } else {
          throw new Error(result.error || 'Upload failed');
        }
        return;
      }

      // Use presigned URLs for single-character PNG/JSON/CharX uploads when available
      // ALL Voxta packages use FormData - server handles multi-char detection and collections
      // (Client-side multi-char detection was unreliable, causing collections to not be created)
      const isVoxtaPackage = parseState.result.card.sourceFormat === 'voxta';
      if (usePresigned && !parseState.result.isMultiCharPackage && !isVoxtaPackage) {
        const { uploadWithPresignedUrls } = await getPresignedUpload();

        const result = await uploadWithPresignedUrls(
          file,
          parseState.result,
          visibility,
          contentHash,
          (progress) => {
            switch (progress.stage) {
              case 'presigning':
                setUploadStage('presigning');
                setUploadProgress(progress.percent);
                break;
              case 'uploading':
                setUploadStage('uploading');
                setUploadProgress(progress.percent);
                setCurrentUploadFile(progress.currentFile || null);
                break;
              case 'confirming':
                setUploadStage('confirming');
                setUploadProgress(progress.percent);
                break;
              case 'done':
                setUploadStage('processing');
                setUploadProgress(100);
                break;
              case 'error':
                throw new Error(progress.error || 'Upload failed');
            }
          }
        );

        if (result.success && result.slug) {
          router.push(`/card/${result.slug}`);
        } else {
          throw new Error(result.error || 'Upload failed');
        }
        return;
      }

      // Fallback to traditional FormData upload
      const formData = new FormData();
      formData.append('file', file);

      // For multi-char packages, DON'T send metadata - let server handle everything
      // This ensures server uses readVoxta to create a collection with all characters
      if (!parseState.result.isMultiCharPackage) {
        // Prepare parsed metadata to send with the file
        const { card } = parseState.result;
        const metadata = {
          name: card.name,
          description: card.description,
          creator: card.creator,
          creatorNotes: card.creatorNotes,
          specVersion: card.specVersion,
          sourceFormat: card.sourceFormat,
          tokens: card.tokens,
          metadata: card.metadata,
          tags: card.tags,
          contentHash,
          visibility,
          // Send the raw card JSON for storage
          cardData: JSON.stringify(card.raw),
        };
        formData.append('metadata', JSON.stringify(metadata));
        formData.append('tags', JSON.stringify(card.tags));
      } else {
        // Just send visibility for multi-char packages
        formData.append('visibility', visibility);
      }

      // Use XMLHttpRequest for upload progress tracking
      setUploadStage('uploading');

      const result = await new Promise<{ data: { slug: string } }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(percent);
          }
        });

        xhr.upload.addEventListener('load', () => {
          // Upload complete, now server is processing
          setUploadStage('processing');
          setUploadProgress(100);
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              resolve(response);
            } catch {
              reject(new Error('Invalid server response'));
            }
          } else {
            try {
              const response = JSON.parse(xhr.responseText);
              reject(new Error(response.error || 'Upload failed'));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload cancelled'));
        });

        xhr.open('POST', '/api/cards');
        xhr.send(formData);
      });

      // Redirect to the new card or collection page
      if (parseState.result.isMultiCharPackage) {
        // Collection response has type: 'collection'
        router.push(`/collection/${result.data.slug}`);
      } else {
        router.push(`/card/${result.data.slug}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploadStage(null);
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  };

  const clearFile = () => {
    if (preview && preview.startsWith('blob:')) {
      URL.revokeObjectURL(preview);
    }
    setFile(null);
    setPreview(null);
    setError(null);
    setParseState({ status: 'idle' });
  };

  const parsedCard = parseState.result?.card;

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold gradient-text mb-2">Upload Character Card</h1>
        <p className="text-starlight/60 mb-8">
          Upload a PNG or JSON character card file. Supports CCv2 and CCv3 formats.
        </p>

        {/* Upload area */}
        <div
          className={`
            relative border-2 border-dashed rounded-xl p-8 text-center transition-all
            ${isDragging ? 'border-aurora bg-aurora/10' : 'border-nebula/40 hover:border-nebula'}
            ${file ? 'bg-cosmic-teal/30' : ''}
          `}
          onDragEnter={handleDragIn}
          onDragLeave={handleDragOut}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept=".png,.json,.charx,.voxpkg"
            onChange={handleFileInput}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />

          {file ? (
            <div className="space-y-4">
              {preview && (
                <div className="relative w-32 h-32 mx-auto rounded-lg overflow-hidden">
                  <img
                    src={preview}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div>
                <p className="font-semibold">{parsedCard?.name || file.name}</p>
                <p className="text-sm text-starlight/60">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>

              {parseState.status === 'parsing' && (
                <div className="flex items-center justify-center gap-2 text-starlight/60">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Parsing card...</span>
                </div>
              )}

              {parseState.status === 'parsed' && parsedCard && (
                <div className="space-y-3">
                  {/* Multi-char package notice */}
                  {parseState.result?.isMultiCharPackage && (
                    <div className="bg-nebula/20 border border-nebula/50 rounded-lg px-4 py-2 text-sm">
                      <span className="font-semibold text-nebula">Collection Package:</span>{' '}
                      <span className="text-starlight">
                        {parseState.result.packageName} ({parseState.result.packageCharCount} characters)
                      </span>
                    </div>
                  )}

                  <div className="flex gap-2 justify-center flex-wrap">
                    <Badge variant={
                      file.name.endsWith('.png') ? 'success' :
                      file.name.endsWith('.charx') ? 'warning' :
                      file.name.endsWith('.voxpkg') ? 'info' : 'outline'
                    }>
                      {parseState.result?.isMultiCharPackage ? 'VOXPKG COLLECTION' : parsedCard.sourceFormat.toUpperCase()}
                    </Badge>
                    {!parseState.result?.isMultiCharPackage && (
                      <>
                        <Badge variant="outline">
                          CC{parsedCard.specVersion}
                        </Badge>
                        <Badge variant="outline">
                          {parsedCard.tokens.total.toLocaleString()} tokens
                        </Badge>
                      </>
                    )}
                  </div>

                  {/* Token breakdown */}
                  <div className="text-xs text-starlight/50 space-y-1">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 max-w-xs mx-auto text-left">
                      {parsedCard.tokens.description > 0 && (
                        <span>Description: {parsedCard.tokens.description}</span>
                      )}
                      {parsedCard.tokens.personality > 0 && (
                        <span>Personality: {parsedCard.tokens.personality}</span>
                      )}
                      {parsedCard.tokens.firstMes > 0 && (
                        <span>First Message: {parsedCard.tokens.firstMes}</span>
                      )}
                      {parsedCard.tokens.mesExample > 0 && (
                        <span>Examples: {parsedCard.tokens.mesExample}</span>
                      )}
                    </div>
                  </div>

                  {/* Metadata badges */}
                  <div className="flex gap-2 justify-center flex-wrap">
                    {parsedCard.metadata.hasAlternateGreetings && (
                      <Badge variant="info" size="sm">
                        {parsedCard.metadata.alternateGreetingsCount} alt greetings
                      </Badge>
                    )}
                    {parsedCard.metadata.hasLorebook && (
                      <Badge variant="warning" size="sm">
                        {parsedCard.metadata.lorebookEntriesCount} lorebook entries
                      </Badge>
                    )}
                    {parsedCard.metadata.hasEmbeddedImages && (
                      <Badge variant="success" size="sm">
                        {parsedCard.metadata.embeddedImagesCount} embedded images
                      </Badge>
                    )}
                  </div>

                  {/* Tags */}
                  {parsedCard.tags.length > 0 && (
                    <div className="flex gap-1 justify-center flex-wrap">
                      {parsedCard.tags.slice(0, 5).map((tag, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 bg-nebula/20 rounded-full text-starlight/70">
                          {tag}
                        </span>
                      ))}
                      {parsedCard.tags.length > 5 && (
                        <span className="text-xs px-2 py-0.5 text-starlight/50">
                          +{parsedCard.tags.length - 5} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
                className="text-sm text-starlight/60 hover:text-starlight"
              >
                Choose different file
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="w-16 h-16 mx-auto cosmic-gradient rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>

              <div>
                <p className="font-semibold text-lg">Drop your character card here</p>
                <p className="text-starlight/60">or click to browse</p>
              </div>

              <div className="flex gap-2 justify-center flex-wrap">
                <Badge variant="outline">PNG</Badge>
                <Badge variant="outline">JSON</Badge>
                <Badge variant="outline">CharX</Badge>
                <Badge variant="outline">Voxta</Badge>
              </div>

              <p className="text-xs text-starlight/40">
                Large files supported (uses chunked upload)
              </p>
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 p-4 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400">
            {error}
          </div>
        )}

        {/* Visibility selector */}
        {file && parseState.status === 'parsed' && (
          <div className="mt-6 glass rounded-xl p-4">
            <h3 className="font-semibold text-starlight mb-3">Visibility</h3>
            <div className="space-y-2">
              {VISIBILITY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    visibility === option.value
                      ? 'bg-nebula/20 border border-nebula/50'
                      : 'bg-deep-space/30 border border-transparent hover:border-nebula/20'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={option.value}
                    checked={visibility === option.value}
                    onChange={(e) => setVisibility(e.target.value as CardVisibility)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-starlight">{option.label}</div>
                    <div className="text-sm text-starlight/60">{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Upload button and progress */}
        {file && parseState.status === 'parsed' && (
          <div className="mt-6 space-y-4">
            {/* Progress indicator during upload */}
            {isUploading && (
              <div className="space-y-2">
                {/* Stage indicator */}
                <div className="flex items-center justify-center gap-2 text-sm">
                  <svg className="w-4 h-4 animate-spin text-aurora" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-starlight/80">
                    {uploadStage === 'preparing' && 'Preparing upload...'}
                    {uploadStage === 'presigning' && 'Getting upload URLs...'}
                    {uploadStage === 'chunking' && (currentUploadFile
                      ? `Uploading ${currentUploadFile}... ${uploadProgress}%`
                      : `Uploading large file... ${uploadProgress}%`
                    )}
                    {uploadStage === 'uploading' && (currentUploadFile
                      ? `Uploading ${currentUploadFile}... ${uploadProgress}%`
                      : `Uploading file... ${uploadProgress}%`
                    )}
                    {uploadStage === 'confirming' && 'Finalizing upload...'}
                    {uploadStage === 'processing' && 'Processing card & assets...'}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 bg-deep-space rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-nebula to-aurora transition-all duration-300 ease-out"
                    style={{
                      width: uploadStage === 'processing' ? '100%' : `${uploadProgress}%`,
                    }}
                  />
                </div>

                {/* Processing indicator - pulsing bar when server is processing */}
                {uploadStage === 'processing' && (
                  <div className="text-xs text-starlight/50 text-center">
                    Server is processing thumbnails and assets...
                  </div>
                )}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-4">
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={handleUpload}
                disabled={isUploading}
              >
                {isUploading ? (
                  uploadStage === 'processing' ? 'Processing...' : 'Uploading...'
                ) : (
                  'Upload Card'
                )}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={clearFile}
                disabled={isUploading}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Info section */}
        <div className="mt-12 glass rounded-xl p-6">
          <h3 className="font-semibold mb-4">Supported Formats</h3>
          <div className="space-y-4 text-sm">
            <div className="flex gap-4">
              <Badge variant="success">PNG</Badge>
              <p className="text-starlight/70 flex-1">
                Character card PNG with embedded JSON data in the tEXt chunk (chara field).
                This is the standard format used by most character card applications.
              </p>
            </div>
            <div className="flex gap-4">
              <Badge variant="info">JSON</Badge>
              <p className="text-starlight/70 flex-1">
                Raw JSON character card following CCv2 or CCv3 specification.
                Note: Cards uploaded as JSON will not have an associated image.
              </p>
            </div>
            <div className="flex gap-4">
              <Badge variant="warning">CharX</Badge>
              <p className="text-starlight/70 flex-1">
                CharX package (.charx) - A ZIP-based format containing card.json and optional assets.
                Used by RisuAI and other applications supporting the CharX specification.
              </p>
            </div>
            <div className="flex gap-4">
              <Badge variant="outline">Voxta</Badge>
              <p className="text-starlight/70 flex-1">
                Voxta package (.voxpkg) - Character package format used by Voxta.
                Contains character data that will be converted to CCv3 format.
              </p>
            </div>
          </div>
        </div>

        {/* Client-side processing note */}
        <div className="mt-4 text-xs text-center text-starlight/40">
          Card parsing and token counting happens in your browser for faster uploads.
        </div>
      </div>
    </AppShell>
  );
}
