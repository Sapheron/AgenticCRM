'use client';

/**
 * Public hosted form renderer — unauthenticated.
 *
 * Fetches the form definition via `GET /public/forms/:slug` and renders
 * the typed fields as a real HTML form with client-side validation.
 * Submits to `POST /public/forms/:slug/submit`.
 *
 * Lives outside the (dashboard) group so it has no nav, no sidebar, no
 * auth gate. Only forms where `status === ACTIVE && isPublic === true`
 * are visible.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, AlertTriangle, Loader2 } from 'lucide-react';

type FormFieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'url';

interface FormField {
  key: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  minLength?: number;
  maxLength?: number;
}

interface PublicForm {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  fields: FormField[];
  requireCaptcha: boolean;
}

const API_ORIGIN =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL
    : '';

function apiUrl(path: string): string {
  if (API_ORIGIN) return `${API_ORIGIN.replace(/\/$/, '')}${path}`;
  // Same-origin fallback for local dev — dashboard on :3001 proxies to API on :3000
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const proto = window.location.protocol;
    return `${proto}//${host}:3000${path}`;
  }
  return path;
}

export default function PublicFormPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load form definition
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(apiUrl(`/public/forms/${slug}`));
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) setLoadError('Form not found or not published.');
          } else {
            if (!cancelled) setLoadError(`Failed to load form (${res.status}).`);
          }
          return;
        }
        const json = (await res.json()) as PublicForm;
        if (cancelled) return;
        setForm(json);
        // Seed default values
        const initial: Record<string, unknown> = {};
        for (const f of json.fields) {
          initial[f.key] = f.type === 'checkbox' ? false : '';
        }
        setValues(initial);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load form');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || submitting) return;
    setSubmitting(true);
    setErrors({});
    try {
      const res = await fetch(apiUrl(`/public/forms/${slug}/submit`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        status?: string;
        validationErrors?: Record<string, string>;
        message?: string;
      };
      if (!res.ok) {
        if (json.validationErrors) {
          setErrors(json.validationErrors);
        } else {
          setErrors({ _form: json.message ?? `Request failed (${res.status})` });
        }
        return;
      }
      if (json.validationErrors && Object.keys(json.validationErrors).length > 0) {
        setErrors(json.validationErrors);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setErrors({ _form: err instanceof Error ? err.message : 'Submission failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const layoutClasses = useMemo(
    () =>
      'min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-blue-50 p-6',
    [],
  );

  if (loading) {
    return (
      <div className={layoutClasses}>
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Loader2 size={14} className="animate-spin" />
          Loading form…
        </div>
      </div>
    );
  }

  if (loadError || !form) {
    return (
      <div className={layoutClasses}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 max-w-md text-center">
          <AlertTriangle size={28} className="mx-auto mb-3 text-amber-500" />
          <h1 className="text-sm font-semibold text-gray-900 mb-1">Form unavailable</h1>
          <p className="text-xs text-gray-500">{loadError}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className={layoutClasses}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-10 max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <Check size={20} className="text-emerald-600" />
          </div>
          <h1 className="text-sm font-semibold text-gray-900 mb-1">Thank you!</h1>
          <p className="text-xs text-gray-500">
            Your submission has been received.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={layoutClasses}>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 max-w-lg w-full">
        <h1 className="text-base font-semibold text-gray-900">{form.name}</h1>
        {form.description && (
          <p className="text-xs text-gray-500 mt-1 mb-5">{form.description}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-5">
          {form.fields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={values[field.key]}
              error={errors[field.key]}
              onChange={(v) => handleChange(field.key, v)}
            />
          ))}

          {errors._form && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg p-3 text-xs text-red-700">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{errors._form}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </form>

        <p className="text-[10px] text-gray-400 text-center mt-4">
          Powered by <span className="font-semibold">Open Agent CRM</span>
        </p>
      </div>
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <label className="block text-xs font-medium text-gray-700 mb-1">
      {field.label}
      {field.required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );

  const describe = field.description && (
    <p className="text-[10px] text-gray-400 mt-0.5">{field.description}</p>
  );

  const errorMsg = error && (
    <p className="text-[11px] text-red-600 mt-1">{error}</p>
  );

  const baseInput =
    'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400';
  const errorClass = error ? ' border-red-300 focus:ring-red-300' : '';

  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'url':
      return (
        <div>
          {label}
          <input
            type={
              field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text'
            }
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            minLength={field.minLength}
            maxLength={field.maxLength}
            className={baseInput + errorClass}
          />
          {describe}
          {errorMsg}
        </div>
      );
    case 'number':
      return (
        <div>
          {label}
          <input
            type="number"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            className={baseInput + errorClass}
          />
          {describe}
          {errorMsg}
        </div>
      );
    case 'date':
      return (
        <div>
          {label}
          <input
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            className={baseInput + errorClass}
          />
          {describe}
          {errorMsg}
        </div>
      );
    case 'textarea':
      return (
        <div>
          {label}
          <textarea
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            rows={4}
            className={baseInput + errorClass}
          />
          {describe}
          {errorMsg}
        </div>
      );
    case 'select':
      return (
        <div>
          {label}
          <select
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            className={baseInput + errorClass}
          >
            <option value="">
              {field.placeholder ?? 'Select...'}
            </option>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {describe}
          {errorMsg}
        </div>
      );
    case 'radio':
      return (
        <div>
          {label}
          <div className="space-y-1.5 mt-1">
            {field.options?.map((o) => (
              <label key={o.value} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name={field.key}
                  value={o.value}
                  checked={value === o.value}
                  onChange={(e) => onChange(e.target.value)}
                  required={field.required}
                  className="accent-violet-500"
                />
                {o.label}
              </label>
            ))}
          </div>
          {describe}
          {errorMsg}
        </div>
      );
    case 'checkbox':
      return (
        <div>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              required={field.required}
              className="accent-violet-500 mt-1"
            />
            <span className="text-xs text-gray-700">
              {field.label}
              {field.required && <span className="text-red-500 ml-0.5">*</span>}
            </span>
          </label>
          {describe}
          {errorMsg}
        </div>
      );
  }
}
