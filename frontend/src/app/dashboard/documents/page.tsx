'use client';
import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useDocuments, useUpload, useDeleteDocument, useRetryDocument } from '@/hooks/useDocuments';
import Link from 'next/link';
import { Upload, FileText, Trash2, Download, RotateCcw } from 'lucide-react';

export default function DocumentsPage() {
  const [page, setPage] = useState(1);
  const [poll, setPoll] = useState(true);
  const { data, isLoading } = useDocuments(page, 20, undefined, poll);
  const { mutate: upload, isPending, progress } = useUpload();
  const { mutate: deleteDoc } = useDeleteDocument();
  const { mutateAsync: retryDoc, isPending: isRetrying } = useRetryDocument();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const statusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Pending';
      case 'queued': return 'Queued';
      case 'ocr_processing': return 'OCR Processing';
      case 'ai_processing': return 'AI Extraction';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      default: return status;
    }
  };
  const isActiveStatus = (status: string) => (
    status === 'pending' || status === 'queued' || status === 'ocr_processing' || status === 'ai_processing'
  );
  const hasActive = data?.data?.some((doc: any) => isActiveStatus(doc.status)) ?? false;
  const isUploading = isPending;
  const isProcessing = hasActive || isRetrying;
  const blockActions = isUploading || isProcessing;

  useEffect(() => {
    setPoll(isPending || hasActive);
  }, [isPending, hasActive]);

  const onDrop = useCallback((accepted: File[]) => {
    accepted.forEach(file => upload(file));
  }, [upload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'image/*': ['.jpg', '.jpeg', '.png'] },
    maxSize: 50 * 1024 * 1024,
    multiple: true,
    disabled: blockActions,
  });

  const handleExport = async (id: string, format: 'json' | 'csv') => {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/documents/${id}/export?format=${format}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` } },
    );
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `extraction.${format}`; a.click();
  };

  return (
    <div className="p-8 max-w-6xl mx-auto relative">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Documents</h1>
      {isProcessing && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent align-middle" />
          Processing in progress. Uploads and actions are temporarily disabled.
        </div>
      )}
      {isProcessing && (
        <div className="pointer-events-none fixed right-6 top-6 z-50 rounded-full bg-white p-3 shadow-md">
          <span className="block h-6 w-6 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
        </div>
      )}

      {/* Upload zone */}
      <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors mb-6 ${
        isDragActive ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
      } ${blockActions ? 'opacity-60 cursor-not-allowed' : ''}`}>
        <input {...getInputProps()} />
        <Upload className="mx-auto text-slate-400 mb-3" size={32} />
        <p className="text-slate-600 font-medium">
          {blockActions ? 'Processing in progress...' : isDragActive ? 'Drop files here...' : 'Drag & drop PDFs here, or click to browse'}
        </p>
        {isProcessing && (
          <div className="mt-3 flex items-center justify-center gap-2 text-xs text-amber-700">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            <span>Working on extraction</span>
          </div>
        )}
        <p className="text-sm text-slate-400 mt-1">Supports PDF, JPG, PNG · Max 50MB</p>
        {isPending && (
          <div className="mt-4">
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all rounded-full" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-sm text-slate-500 mt-1">Uploading... {progress}%</p>
          </div>
        )}
      </div>

      {/* Documents table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['File', 'Type', 'Status', 'Date', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
            )}
            {data?.data?.map((doc: any) => (
              <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-slate-400 shrink-0" />
                    <Link href={`/dashboard/documents/${doc.id}`}
                      className="text-blue-600 hover:underline font-medium truncate max-w-[200px]">
                      {doc.originalFilename}
                    </Link>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600 capitalize">{doc.documentType ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                    doc.status === 'completed' ? 'bg-green-100 text-green-700' :
                    doc.status === 'failed'    ? 'bg-red-100 text-red-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {isActiveStatus(doc.status) && (
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
                    )}
                    {statusLabel(doc.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(doc.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {(doc.status === 'pending' || doc.status === 'failed') && (
                      <button
                        onClick={async () => {
                          setRetryingId(doc.id);
                          try { await retryDoc(doc.id); } finally { setRetryingId(null); }
                        }}
                        title="Retry processing"
                        disabled={blockActions}
                        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {retryingId === doc.id ? (
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                        ) : (
                          <RotateCcw size={15} />
                        )}
                      </button>
                    )}
                    {doc.status === 'completed' && <>
                      <button onClick={() => handleExport(doc.id, 'json')} title="Export JSON" disabled={blockActions}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        <Download size={15} />
                      </button>
                      <button onClick={() => handleExport(doc.id, 'csv')} title="Export CSV" disabled={blockActions}
                        className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                        CSV
                      </button>
                    </>}
                    <button onClick={() => deleteDoc(doc.id)} title="Delete" disabled={blockActions}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.meta && (
          <div className="px-4 py-3 border-t border-slate-100 flex justify-between items-center text-sm text-slate-500">
            <span>Showing {data.data.length} of {data.meta.total}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors">
                Prev
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= data.meta.totalPages}
                className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
