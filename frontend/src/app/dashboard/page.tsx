'use client';
import { useDocuments } from '@/hooks/useDocuments';
import { useUsage } from '@/hooks/useSubscription';
import Link from 'next/link';

export default function DashboardPage() {
  const { data: docsData } = useDocuments(1, 5);
  const { data: usage } = useUsage();

  const usagePct = usage
    ? usage.documentsLimit === -1
      ? 0
      : Math.round((usage.documentsUsed / usage.documentsLimit) * 100)
    : 0;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Documents this month</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">
            {usage?.documentsUsed ?? 0}
            <span className="text-lg text-slate-400 font-normal">
              /{usage?.documentsLimit === -1 ? '∞' : usage?.documentsLimit ?? 10}
            </span>
          </p>
          <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${usagePct}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total documents</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{docsData?.meta?.total ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Pages processed</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{usage?.pagesProcessed ?? 0}</p>
        </div>
      </div>

      {/* Quick upload CTA */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-slate-900">Upload a document</h2>
          <p className="text-sm text-slate-500 mt-1">Upload a PDF invoice, receipt, or bank statement to extract data</p>
        </div>
        <Link href="/dashboard/documents"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          Upload PDF
        </Link>
      </div>

      {/* Recent documents */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h2 className="font-semibold text-slate-900">Recent Documents</h2>
          <Link href="/dashboard/documents" className="text-sm text-blue-600 hover:underline">View all</Link>
        </div>
        <div className="divide-y divide-slate-100">
          {docsData?.data?.length === 0 && (
            <p className="p-5 text-sm text-slate-400">No documents yet. Upload your first PDF above.</p>
          )}
          {docsData?.data?.map((doc: any) => (
            <Link key={doc.id} href={`/dashboard/documents/${doc.id}`}
              className="flex items-center justify-between p-5 hover:bg-slate-50 transition-colors">
              <div>
                <p className="text-sm font-medium text-slate-900">{doc.originalFilename}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {doc.documentType ?? 'Unknown type'} · {new Date(doc.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                doc.status === 'completed' ? 'bg-green-100 text-green-700' :
                doc.status === 'failed'    ? 'bg-red-100 text-red-700' :
                'bg-yellow-100 text-yellow-700'
              }`}>
                {doc.status}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
