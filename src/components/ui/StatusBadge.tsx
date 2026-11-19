import { AlertCircle, CheckCircle2, Clock, MinusCircle, RotateCcw } from 'lucide-react';

export type SemanticTone = 'success' | 'warning' | 'orange' | 'danger' | 'neutral' | 'info';

interface StatusBadgeProps {
  tone: SemanticTone;
  label: string;
}

const TONE_STYLES: Record<SemanticTone, string> = {
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  orange: 'bg-orange-50 text-orange-800 border-orange-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
  info: 'bg-blue-50 text-[#12345A] border-blue-200',
  neutral: 'bg-slate-100 text-[#64748B] border-slate-200',
};

function StatusIcon({ tone }: { tone: SemanticTone }) {
  switch (tone) {
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    case 'warning':
      return <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    case 'orange':
      return <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    case 'danger':
      return <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    case 'info':
      return <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    default:
      return <MinusCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  }
}

export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${TONE_STYLES[tone]}`}
    >
      <StatusIcon tone={tone} />
      <span>{label}</span>
    </span>
  );
}
