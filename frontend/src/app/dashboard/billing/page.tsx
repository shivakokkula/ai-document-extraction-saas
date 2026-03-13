'use client';
import { usePlans, useSubscription, useUsage, useCreateCheckout, useCreatePortal } from '@/hooks/useSubscription';
import { Check } from 'lucide-react';

export default function BillingPage() {
  const { data: plans } = usePlans();
  const { data: sub } = useSubscription();
  const { data: usage } = useUsage();
  const checkout = useCreateCheckout();
  const portal = useCreatePortal();

  const currentPlan = sub?.plan ?? 'free';

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Billing</h1>
      <p className="text-slate-500 mb-8">Manage your plan and usage</p>

      {/* Current usage */}
      {usage && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-8">
          <h2 className="font-semibold text-slate-900 mb-3">This month's usage</h2>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">Documents processed</span>
                <span className="font-medium">{usage.documentsUsed} / {usage.documentsLimit === -1 ? '∞' : usage.documentsLimit}</span>
              </div>
              {usage.documentsLimit !== -1 && (
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${Math.min(100, (usage.documentsUsed / usage.documentsLimit) * 100)}%` }} />
                </div>
              )}
            </div>
            {sub?.stripeSubscriptionId && (
              <button onClick={() => portal.mutate()}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                Manage billing
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pricing plans */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans && Object.entries(plans).map(([key, plan]: [string, any]) => {
          const isCurrent = currentPlan === key;
          return (
            <div key={key} className={`bg-white rounded-xl border p-6 relative ${
              key === 'pro' ? 'border-blue-500 shadow-md' : 'border-slate-200'
            }`}>
              {key === 'pro' && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-medium px-3 py-1 rounded-full">
                  Most popular
                </span>
              )}
              <h3 className="font-bold text-slate-900 text-lg">{plan.name}</h3>
              <div className="mt-2 mb-4">
                <span className="text-3xl font-bold text-slate-900">
                  {plan.price === 0 ? 'Free' : `₹${plan.price.toLocaleString()}`}
                </span>
                {plan.price > 0 && <span className="text-slate-400 text-sm">/mo</span>}
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f: string) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                    <Check size={16} className="text-green-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="w-full py-2 text-center text-sm font-medium text-slate-500 bg-slate-100 rounded-lg">
                  Current plan
                </div>
              ) : key !== 'free' ? (
                <button
                  onClick={() => checkout.mutate(key as 'pro' | 'enterprise')}
                  disabled={checkout.isPending}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                    key === 'pro'
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                  } disabled:opacity-50`}>
                  {checkout.isPending ? 'Redirecting...' : 'Upgrade →'}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
