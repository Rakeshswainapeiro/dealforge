/* eslint-disable react/prop-types */

export default function SiriusHeaderMeta({ company = 'coredge', layout = 'Left-to-Right' }) {
  return (
    <div className="flex items-center justify-end gap-3 text-xs text-slate-500 py-1">
      <span>Layout: {layout}</span>
      <span>
        <strong className="font-semibold text-slate-700">Company:</strong>{' '}
        <span className="font-semibold text-slate-900">{company}</span>
      </span>
    </div>
  );
}
