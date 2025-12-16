/**
 * Custom Switch Widget for AutoForm
 *
 * Replaces the default headless checkbox with a styled toggle switch.
 */

interface SwitchWidgetProps {
  value: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  name?: string;
}

export function SwitchWidget({
  value,
  onChange,
  label,
  helperText,
  disabled = false,
  name,
}: SwitchWidgetProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1">
        {label && (
          <label
            htmlFor={name}
            className="block text-sm font-medium text-starlight mb-1"
          >
            {label}
          </label>
        )}
        {helperText && (
          <p className="text-xs text-starlight/60">{helperText}</p>
        )}
      </div>

      <button
        id={name}
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => !disabled && onChange(!value)}
        className={`
          relative inline-flex h-6 w-11 items-center rounded-full
          transition-colors focus:outline-none focus:ring-2 focus:ring-nebula focus:ring-offset-2
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${value ? 'bg-nebula' : 'bg-starlight/20'}
        `}
      >
        <span
          className={`
            inline-block h-5 w-5 transform rounded-full bg-starlight
            transition-transform shadow-md
            ${value ? 'translate-x-5' : 'translate-x-0.5'}
          `}
        />
      </button>
    </div>
  );
}
