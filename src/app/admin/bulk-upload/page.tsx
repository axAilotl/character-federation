'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui';

interface UploadItem {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  cardName?: string;
  slug?: string;
}

export default function BulkUploadPage() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const validExtensions = ['.png', '.json', '.charx', '.voxpkg'];
    const newItems: UploadItem[] = [];

    for (const file of Array.from(files)) {
      const hasValidExtension = validExtensions.some(ext =>
        file.name.toLowerCase().endsWith(ext)
      );

      if (hasValidExtension && file.size <= 50 * 1024 * 1024) {
        newItems.push({
          id: crypto.randomUUID(),
          file,
          status: 'pending',
        });
      }
    }

    setItems(prev => [...prev, ...newItems]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const uploadSingle = async (item: UploadItem): Promise<void> => {
    setItems(prev => prev.map(i =>
      i.id === item.id ? { ...i, status: 'uploading' } : i
    ));

    try {
      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('visibility', 'public');

      const response = await fetch('/api/cards', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      const data = await response.json();

      setItems(prev => prev.map(i =>
        i.id === item.id
          ? { ...i, status: 'success', cardName: data.data?.name, slug: data.data?.slug }
          : i
      ));
    } catch (err) {
      setItems(prev => prev.map(i =>
        i.id === item.id
          ? { ...i, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }
          : i
      ));
    }
  };

  const uploadAll = async () => {
    setIsUploading(true);
    const pendingItems = items.filter(i => i.status === 'pending');

    // Upload sequentially to avoid overwhelming the server
    for (const item of pendingItems) {
      await uploadSingle(item);
    }

    setIsUploading(false);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const clearCompleted = () => {
    setItems(prev => prev.filter(i => i.status !== 'success'));
  };

  const clearAll = () => {
    setItems([]);
  };

  const pendingCount = items.filter(i => i.status === 'pending').length;
  const successCount = items.filter(i => i.status === 'success').length;
  const errorCount = items.filter(i => i.status === 'error').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-starlight">Bulk Upload</h1>
          <p className="text-starlight/60 text-sm mt-1">
            Upload multiple character cards at once for testing
          </p>
        </div>
        <div className="flex gap-2">
          {successCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearCompleted}>
              Clear Completed ({successCount})
            </Button>
          )}
          {items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear All
            </Button>
          )}
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-colors mb-6
          ${isDragging
            ? 'border-nebula bg-nebula/10'
            : 'border-nebula/30 hover:border-nebula/50'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".png,.json,.charx,.voxpkg"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />

        <svg className="w-12 h-12 mx-auto mb-4 text-nebula/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>

        <p className="text-starlight/70 mb-2">
          Drag and drop character card files here
        </p>
        <p className="text-starlight/50 text-sm mb-4">
          PNG, JSON, CharX, Voxta (max 50MB each)
        </p>

        <Button
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
        >
          Select Files
        </Button>
      </div>

      {/* Upload button */}
      {pendingCount > 0 && (
        <div className="flex items-center justify-between mb-6 p-4 glass rounded-lg">
          <div className="text-starlight/70">
            <span className="font-semibold text-starlight">{pendingCount}</span> files ready to upload
            {successCount > 0 && (
              <span className="ml-2 text-green-400">({successCount} completed)</span>
            )}
            {errorCount > 0 && (
              <span className="ml-2 text-red-400">({errorCount} failed)</span>
            )}
          </div>
          <Button
            variant="primary"
            onClick={uploadAll}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : `Upload ${pendingCount} Files`}
          </Button>
        </div>
      )}

      {/* File list */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={`
                flex items-center justify-between p-3 rounded-lg
                ${item.status === 'success' ? 'bg-green-500/10 border border-green-500/30' : ''}
                ${item.status === 'error' ? 'bg-red-500/10 border border-red-500/30' : ''}
                ${item.status === 'pending' ? 'glass' : ''}
                ${item.status === 'uploading' ? 'glass border border-nebula/50' : ''}
              `}
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {item.status === 'pending' && (
                    <div className="w-5 h-5 rounded-full border-2 border-starlight/30" />
                  )}
                  {item.status === 'uploading' && (
                    <svg className="w-5 h-5 animate-spin text-nebula" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  {item.status === 'success' && (
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {item.status === 'error' && (
                    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>

                {/* File info */}
                <div className="min-w-0">
                  <p className="text-starlight truncate">
                    {item.status === 'success' && item.cardName
                      ? item.cardName
                      : item.file.name
                    }
                  </p>
                  <p className="text-xs text-starlight/50">
                    {item.status === 'success' && item.slug && (
                      <a
                        href={`/card/${item.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-nebula hover:underline"
                      >
                        View card →
                      </a>
                    )}
                    {item.status === 'error' && (
                      <span className="text-red-400">{item.error}</span>
                    )}
                    {item.status === 'pending' && (
                      <span>{(item.file.size / 1024 / 1024).toFixed(2)} MB</span>
                    )}
                    {item.status === 'uploading' && (
                      <span className="text-nebula">Uploading...</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Remove button */}
              {item.status !== 'uploading' && (
                <button
                  onClick={() => removeItem(item.id)}
                  className="flex-shrink-0 p-1 text-starlight/50 hover:text-starlight transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="text-center py-12 text-starlight/50">
          No files selected. Drag and drop files or click &quot;Select Files&quot; to begin.
        </div>
      )}
    </div>
  );
}
