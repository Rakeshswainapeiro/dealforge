/* eslint-disable react/prop-types */
import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Paperclip } from 'lucide-react';

export default function SiriusQACard({ opportunityId, sectionKey = 'executive_summary', showSampleThread = false }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(true);
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);

  const threadsQuery = useQuery({
    queryKey: ['review', 'threads', opportunityId, sectionKey],
    queryFn: () => api.qa.threads(opportunityId, { section: sectionKey }),
    enabled: Boolean(opportunityId),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const body = text.trim();
      if (!body) return;
      const thread = await api.qa.open(opportunityId, {
        subject: `${sectionKey.replace(/_/g, ' ')}: ${body.slice(0, 80)}`,
        body,
        section: sectionKey,
        requires_response: !internal,
        visibility: internal ? 'internal' : 'shared',
      });
      for (const file of files) {
        await api.qa.attach(thread.id, file, { body: `Attached ${file.name}` });
      }
      return thread;
    },
    onSuccess: () => {
      setText('');
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      queryClient.invalidateQueries({ queryKey: ['review', 'threads', opportunityId, sectionKey] });
      toast({
        title: internal ? 'Internal note saved' : 'Question sent to the subsidiary',
        description: internal ? 'Only the Sirius team can see it.' : 'It is now in their Q&A inbox.',
      });
    },
    onError: (err) => {
      toast({
        variant: 'destructive',
        title: 'Could not send',
        description: err?.message || 'Failed to send question',
      });
    },
  });

  const threads = threadsQuery.data?.threads || [];

  return (
    <div className="space-y-4">
      {/* Standard Section Q&A Box */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
        <div>
          <h3 className="text-xs font-bold text-slate-900">Question &amp; Answer</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {threads.length > 0 ? `${threads.length} question(s) on this section` : 'No questions on this section yet.'}
          </p>
        </div>

        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What do you need from the subsidiary?"
          className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`internal-${sectionKey}`}
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
          />
          <label htmlFor={`internal-${sectionKey}`} className="text-[11px] text-slate-700 cursor-pointer select-none">
            Internal note: only the Sirius team sees it
          </label>
        </div>

        {files.length > 0 && (
          <div className="text-[11px] text-slate-600 space-y-0.5">
            {files.map((f) => (
              <p key={f.name} className="flex items-center gap-1">
                <Paperclip className="w-3 h-3 text-slate-400" /> {f.name}
              </p>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <input
            type="file"
            ref={fileInputRef}
            multiple
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold py-2 rounded-lg transition-colors shadow-sm"
          >
            Attach Documents
          </button>
          <button
            type="button"
            disabled={!text.trim() || sendMutation.isPending}
            onClick={() => sendMutation.mutate()}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg transition-colors shadow-sm"
          >
            {sendMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Send'}
          </button>
        </div>
      </div>

      {/* In SIT-2, display the Q&A thread card if on executive_summary */}
      {showSampleThread && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-900">Question &amp; Answer</h3>
          </div>

          {/* Date Divider */}
          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-100"></div>
            <span className="flex-shrink mx-3 text-[11px] text-slate-400 font-medium">29 Sept</span>
            <div className="flex-grow border-t border-slate-100"></div>
          </div>

          {/* Thread messages */}
          <div className="space-y-3">
            {/* Bubble 1: Deal Lead A */}
            <div className="space-y-1">
              <p className="text-[11px] text-slate-400 text-right">Deal Lead A · 29 Sept, 11:00</p>
              <div className="bg-white border border-blue-200 rounded-lg p-3 text-xs text-slate-800 shadow-sm max-w-[90%] ml-auto">
                Top customer is 41% of revenue. When does that contract end, and is renewal agreed?
              </div>
            </div>

            {/* Bubble 2: DealForge AI note */}
            <div className="space-y-1">
              <p className="text-[11px] text-slate-400">DealForge AI · visible to Sirius only · 29 Sept, 11:00</p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 shadow-sm max-w-[90%]">
                Visible to the reviewer only. Contract on file ends Jun 2027. No renewal document is in the pack.
              </div>
            </div>

            {/* Bubble 3: Deal Lead A */}
            <div className="space-y-1">
              <p className="text-[11px] text-slate-400 text-right">Deal Lead A · 29 Sept, 11:00</p>
              <div className="bg-white border border-blue-200 rounded-lg p-3 text-xs text-slate-800 shadow-sm max-w-[90%] ml-auto">
                Top customer is 41% of revenue. When does that contract end, and is renewal agreed?
              </div>
            </div>
          </div>

          {/* Reply input */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <textarea
              rows={3}
              placeholder="Write your reply"
              className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="internal-reply"
                defaultChecked
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
              />
              <label htmlFor="internal-reply" className="text-[11px] text-slate-700 cursor-pointer select-none">
                Internal note: only the Sirius team sees it
              </label>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                className="flex-1 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold py-2 rounded-lg transition-colors shadow-sm"
              >
                Attach Documents
              </button>
              <button
                type="button"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors shadow-sm"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
