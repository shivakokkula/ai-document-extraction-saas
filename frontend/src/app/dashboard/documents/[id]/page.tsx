'use client';

import Link from 'next/link';
import { useDocument, useDocumentStatus } from '@/hooks/useDocuments';

type DetailPageProps = {
  params: {
    id: string;
  };
};

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'ocr_processing', 'ai_processing']);

export default function DocumentDetailPage({ params }: DetailPageProps) {
  const { id } = params;
  const { data: document, isLoading, isError } = useDocument(id);
  const liveStatusEnabled = ACTIVE_STATUSES.has(document?.status ?? '');
  const { data: status } = useDocumentStatus(id, liveStatusEnabled);

  const currentStatus = status?.status ?? document?.status;
  const extraction = document?.extraction;
  const fields = extraction?.extractedFields as Record<string, unknown> | undefined;

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <p className="text-sm text-slate-500">Loading document details...</p>
      </div>
    );
  }

  if (isError || !document) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Link href="/dashboard/documents" className="text-sm text-blue-600 hover:underline">
          Back to documents
        </Link>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          Document not found or unavailable.
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/documents" className="text-sm text-blue-600 hover:underline">
            Back to documents
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">{document.originalFilename}</h1>
          <p className="mt-2 text-sm text-slate-500">
            Uploaded {new Date(document.createdAt).toLocaleString()}
          </p>
        </div>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
          currentStatus === 'completed'
            ? 'bg-green-100 text-green-700'
            : currentStatus === 'failed'
              ? 'bg-red-100 text-red-700'
              : 'bg-amber-100 text-amber-700'
        }`}>
          {currentStatus}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">Document type</p>
          <p className="mt-2 text-sm font-medium text-slate-900">{document.documentType ?? 'Not classified yet'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">Pages</p>
          <p className="mt-2 text-sm font-medium text-slate-900">{document.pageCount ?? 'Unknown'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">File size</p>
          <p className="mt-2 text-sm font-medium text-slate-900">
            {Intl.NumberFormat().format(document.fileSizeBytes)} bytes
          </p>
        </div>
      </div>

      {status?.errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-medium text-red-700">Processing error</p>
          <p className="mt-2 text-sm text-red-600">{status.errorMessage}</p>
        </div>
      )}

      {!extraction && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Extraction</h2>
          <p className="mt-2 text-sm text-slate-500">
            {currentStatus === 'failed'
              ? 'Parsing failed. Check the error above and retry after fixing the AI service or document input.'
              : 'This document has not been parsed yet. Once processing completes, extracted fields will appear here.'}
          </p>
        </div>
      )}

      {extraction && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-slate-900">Summary</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Vendor</p>
                <p className="mt-1 text-sm text-slate-900">{extraction.vendorName ?? 'Not found'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Invoice number</p>
                <p className="mt-1 text-sm text-slate-900">{extraction.invoiceNumber ?? 'Not found'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Amount</p>
                <p className="mt-1 text-sm text-slate-900">
                  {extraction.totalAmount ? `${extraction.currency ?? ''} ${extraction.totalAmount}`.trim() : 'Not found'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Invoice date</p>
                <p className="mt-1 text-sm text-slate-900">
                  {extraction.invoiceDate ? new Date(extraction.invoiceDate).toLocaleDateString() : 'Not found'}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-slate-900">Extracted fields</h2>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
              {JSON.stringify(fields ?? {}, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
